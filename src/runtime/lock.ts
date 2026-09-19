import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs"
import { basename, dirname, join } from "node:path"

import { Clock, Duration, Effect } from "effect"

import { LOCK_DEFAULT_TIMEOUT_MS, LOCK_RETRY_MS } from "../ids.ts"
import { FlockError, LockTimeout } from "./errors.ts"
import { errnoCode, tryExclusive, unlock } from "./flock.ts"

function openLockFile(path: string): number {
  mkdirSync(dirname(path), { recursive: true })

  return openSync(path, "a+")
}

const waitForExclusive = Effect.fnUntraced(function*(
  path: string,
  fd: number,
  timeoutMillis: number,
): Effect.fn.Return<void, LockTimeout | FlockError> {
  const started = yield* Clock.monotonicTimeNanos
  const deadline = started + BigInt(timeoutMillis) * 1_000_000n

  while (true) {
    const status = tryExclusive(fd)

    if (status === "acquired") return

    if (status === "failed") {
      return yield* new FlockError({ path, message: `flock failed errno=${errnoCode()}` })
    }

    const now = yield* Clock.monotonicTimeNanos

    if (timeoutMillis === 0 || now >= deadline) {
      return yield* new LockTimeout({ path })
    }

    yield* Effect.sleep(Duration.millis(LOCK_RETRY_MS))
  }
})

export const withExclusiveLock = Effect.fnUntraced(
  function*<A, E, R>(
    lockPath: string,
    body: Effect.Effect<A, E, R>,
    timeoutMillis = LOCK_DEFAULT_TIMEOUT_MS,
  ) {
    const fd = yield* Effect.acquireRelease(
      Effect.sync(() => openLockFile(lockPath)),
      (openFd) =>
        Effect.sync(() => {
          unlock(openFd)
          closeSync(openFd)
        }),
    )

    yield* waitForExclusive(lockPath, fd, timeoutMillis)

    return yield* body
  },
  (effect) => Effect.scoped(effect),
)

export function pluginLockPath(stateDir: string, name = "plugin.lock"): string {
  return join(stateDir, name)
}

export function atomicWrite(path: string, text: string): void {
  const directory = dirname(path) || "."
  mkdirSync(directory, { recursive: true })
  const tmp = join(directory, `.${basename(path)}.tmp.${process.pid}`)
  const fd = openSync(tmp, "w")

  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  renameSync(tmp, path)
}
