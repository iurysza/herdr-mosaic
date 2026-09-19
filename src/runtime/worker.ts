import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, existsSync, openSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"

import { Clock, Duration, Effect, Result, Schema } from "effect"

import { publishSidebar } from "../agents/sidebar-publish.ts"
import { PLUGIN_ID, REFRESH_INTERVAL_SECONDS } from "../ids.ts"
import { CommandFailed, RpcTransportError } from "./errors.ts"
import { atomicWrite, pluginLockPath, withExclusiveLock } from "./lock.ts"
import { emptyOutput, pluginWarn } from "./plugin-log.ts"
import type { PluginPathValues } from "./paths.ts"
import { PluginPaths } from "./paths.ts"
import { rpcCall } from "./rpc.ts"
import { load } from "../state/store.ts"

const PluginRecord = Schema.Struct({
  plugin_id: Schema.optionalKey(Schema.String),
  enabled: Schema.optionalKey(Schema.Boolean),
  plugin_root: Schema.optionalKey(Schema.String),
})

const PluginList = Schema.Struct({
  plugins: Schema.optionalKey(Schema.Array(PluginRecord)),
})

const StateSidebar = Schema.Struct({
  sidebar_installed: Schema.optionalKey(Schema.Boolean),
})

export function generationKey(
  socketRealPath: string,
  device: number | bigint,
  inode: number | bigint,
  ctimeNs: number | bigint,
): string {
  return `${socketRealPath}:${device}:${inode}:${ctimeNs}`
}

export function resolveSocketPath(socketPath: string): string {
  try {
    return realpathSync(socketPath)
  } catch (error) {
    // Darwin libuv realpath(3) returns EOPNOTSUPP on unix sockets.
    if (error instanceof Error && "code" in error && error.code === "EOPNOTSUPP") {
      return join(realpathSync(dirname(socketPath)), basename(socketPath))
    }

    throw error
  }
}

export function readSocketGeneration(socketPath: string): string {
  const real = resolveSocketPath(socketPath)
  const info = statSync(real, { bigint: true })

  return generationKey(real, info.dev, info.ino, info.ctimeNs)
}

export function workerLockName(key: string): string {
  return `refresh-${createHash("sha256").update(key).digest("hex")}.lock`
}

export function workerLockPath(stateDir: string, key: string): string {
  return join(stateDir, workerLockName(key))
}

export function workerHeartbeatPath(stateDir: string, key: string): string {
  return join(stateDir, `refresh-${createHash("sha256").update(key).digest("hex")}.json`)
}

export const withWorkerOwnership = Effect.fnUntraced(function*<A, E, R>(
  stateDir: string,
  key: string,
  body: Effect.Effect<A, E, R>,
) {
  return yield* withExclusiveLock(pluginLockPath(stateDir, workerLockName(key)), body, 0)
})

export function sidebarInstalled(stateDir: string): boolean {
  const path = join(stateDir, "state.json")

  if (!existsSync(path)) return false

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    const decoded = Schema.decodeUnknownResult(StateSidebar)(parsed)

    return Result.isSuccess(decoded) && decoded.success.sidebar_installed === true
  } catch {
    return false
  }
}

export const pluginRegistered = Effect.fnUntraced(function*(pluginRoot: string) {
  const listed = yield* rpcCall("plugin.list", { plugin_id: PLUGIN_ID })
  const decoded = Schema.decodeUnknownResult(PluginList)(listed)
  const plugins = Result.isSuccess(decoded) ? decoded.success.plugins ?? [] : []
  const expected = realpathSync(pluginRoot)

  for (const plugin of plugins) {
    if (plugin.plugin_id !== PLUGIN_ID || plugin.enabled !== true) continue

    const root = plugin.plugin_root ?? ""

    if (root !== "" && realpathSync(root) === expected) return true
  }

  return false
})

export function refreshWorkerArgs(execPath: string, cliPath: string, key: string): readonly string[] {
  const base = basename(execPath)

  if (base === "bun" || base === "bun.exe") {
    return ["--no-env-file", cliPath, "refresh-worker", key]
  }

  return ["refresh-worker", key]
}

export function spawnDetachedWorker(options: {
  readonly execPath: string
  readonly cliPath: string
  readonly key: string
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly logPath: string
}): number {
  const log = openSync(options.logPath, "a")

    const child = spawn(
      options.execPath,
      refreshWorkerArgs(options.execPath, options.cliPath, options.key).slice(),
    {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", log, log],
    },
  )

  child.unref()
  closeSync(log)

  return child.pid ?? 0
}

export const runRefreshWorker = Effect.fnUntraced(function*(key: string) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  return yield* withWorkerOwnership(paths.stateDir, key, refreshLoop(paths, output, key)).pipe(
    Effect.catchTag("LockTimeout", () => Effect.succeed(0)),
  )
})

const refreshLoop = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: ReturnType<typeof emptyOutput>,
  key: string,
) {
  while (true) {
    const started = yield* Clock.monotonicTimeNanos
    const round = yield* refreshRound(paths, key).pipe(Effect.result)

    if (Result.isSuccess(round)) {
      if (round.success !== undefined) return round.success

      if (process.env.MOSAIC_TEST_ISOLATED === "1") return 0
    } else {
      const error = round.failure

      const message = error instanceof RpcTransportError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error)

      yield* pluginWarn(paths, output, `sidebar refresh failed: ${message}`)

      if (error instanceof RpcTransportError && error.code === "socket_unavailable") return 1

      if (process.env.MOSAIC_TEST_ISOLATED === "1") return 0
    }

    const ended = yield* Clock.monotonicTimeNanos
    const elapsedMs = Number((ended - started) / 1_000_000n)

    yield* Effect.sleep(Duration.millis(Math.max(0, REFRESH_INTERVAL_SECONDS * 1000 - elapsedMs)))
  }
})

const refreshRound = Effect.fnUntraced(function*(paths: PluginPathValues, key: string) {
  return yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    refreshRoundLocked(paths, key),
  )
})

const refreshRoundLocked = Effect.fnUntraced(function*(paths: PluginPathValues, key: string) {
  const current = yield* Effect.try({
    try: () => readSocketGeneration(paths.socketPath),
    catch: (cause) =>
      new RpcTransportError({
        code: "socket_unavailable",
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  })

  if (current !== key) return 0

  if (!(yield* pluginRegistered(paths.pluginRoot))) return 0

  if (!sidebarInstalled(paths.stateDir)) return 0

  const started = yield* Clock.monotonicTimeNanos
  const count = yield* publishSidebar(load(join(paths.stateDir, "state.json")))
  const ended = yield* Clock.monotonicTimeNanos
  const publishedAt = (yield* Clock.currentTimeMillis) / 1000

  const heartbeat = {
    pid: process.pid,
    published_at: publishedAt,
    agents: count,
    duration_seconds: Number(ended - started) / 1_000_000_000,
  }

  atomicWrite(workerHeartbeatPath(paths.stateDir, key), `${JSON.stringify(heartbeat)}\n`)

  return undefined
})

export const startRefreshWorker = Effect.fnUntraced(function*(
  execPath: string,
  cliPath: string,
) {
  const paths = yield* PluginPaths

  return yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    tryStart(paths, execPath, cliPath),
  )
})

const tryStart = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  execPath: string,
  cliPath: string,
) {
  if (!sidebarInstalled(paths.stateDir)) return 0

  if (!(yield* pluginRegistered(paths.pluginRoot))) {
    return yield* new CommandFailed({
      command: "refresh-worker",
      message: "enable Mosaic from this checkout before starting sidebar refresh",
    })
  }

  const key = readSocketGeneration(paths.socketPath)

  const available = yield* withWorkerOwnership(paths.stateDir, key, Effect.succeed(true)).pipe(
    Effect.catchTag("LockTimeout", () => Effect.succeed(false)),
  )

  if (!available) return 0

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HERDR_PLUGIN_ID: PLUGIN_ID,
    HERDR_PLUGIN_ROOT: paths.pluginRoot,
    HERDR_PLUGIN_CONFIG_DIR: paths.configDir,
    HERDR_PLUGIN_STATE_DIR: paths.stateDir,
    HERDR_CONFIG_PATH: paths.herdrConfigPath,
    HERDR_SOCKET_PATH: paths.socketPath,
    HERDR_BIN_PATH: paths.herdrBin,
  }

  return spawnDetachedWorker({
    execPath,
    cliPath,
    key,
    cwd: paths.pluginRoot,
    env,
    logPath: join(paths.stateDir, "refresh.log"),
  })
})
