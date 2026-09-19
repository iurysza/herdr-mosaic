import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Clock, Duration, Effect, Predicate } from "effect"

import { pluginLockPath, withExclusiveLock } from "../../src/runtime/lock.ts"

function waitExit(child: ReturnType<typeof spawn>): Promise<{
  code: number | null
  stdout: string
  stderr: string
}> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

function spawnHolder(stateDir: string, holdMs: string, timeoutMs = "2000") {
  return spawn(process.execPath, [join(import.meta.dir, "hold-lock.ts"), holdMs, timeoutMs], {
    env: { ...process.env, HERDR_PLUGIN_STATE_DIR: stateDir },
    stdio: ["ignore", "pipe", "pipe"],
  })
}

describe("cross-process lock", () => {
  test("a second process waits, then a killed holder releases the lock", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mosaic-lock-"))
    const holder = spawnHolder(stateDir, "4000")

    const first = await new Promise<string>((resolve) => {
      holder.stdout?.on("data", (chunk) => resolve(String(chunk)))
    })

    expect(first).toContain("held:")

    const waiter = spawnHolder(stateDir, "50")
    await Bun.sleep(80)
    expect(waiter.exitCode).toBeNull()

    holder.kill("SIGKILL")
    const waited = await waitExit(waiter)
    expect(waited.code).toBe(0)
    expect(waited.stdout).toContain("held:")
  }, 10_000)

  test("SIGINT during wait leaves the lock free", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mosaic-lock-"))
    const holder = spawnHolder(stateDir, "4000")
    await new Promise<void>((resolve) => {
      holder.stdout?.on("data", () => resolve())
    })

    const waiter = spawnHolder(stateDir, "50", "4000")
    await Bun.sleep(80)
    expect(waiter.exitCode).toBeNull()
    waiter.kill("SIGINT")
    await waitExit(waiter)

    holder.kill("SIGKILL")
    await waitExit(holder)

    const next = spawnHolder(stateDir, "20")
    const acquired = await waitExit(next)
    expect(acquired.code).toBe(0)
    expect(acquired.stdout).toContain("held:")
  }, 10_000)

  test("a real-time waiter times out while another process holds the lock", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mosaic-lock-"))
    const holder = spawnHolder(stateDir, "4000")
    await new Promise<void>((resolve) => {
      holder.stdout?.on("data", () => resolve())
    })

    const started = Date.now()
    const waiter = spawnHolder(stateDir, "50", "200")
    const waited = await waitExit(waiter)
    const elapsed = Date.now() - started

    try {
      expect(waited.code).not.toBe(0)
      expect(elapsed).toBeGreaterThanOrEqual(150)
      expect(elapsed).toBeLessThan(2_000)
    } finally {
      holder.kill("SIGKILL")
      await waitExit(holder)
    }
  }, 10_000)

  test("timeout uses the Effect clock while another process holds the lock", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mosaic-lock-"))
    const holder = spawnHolder(stateDir, "4000")
    await new Promise<void>((resolve) => {
      holder.stdout?.on("data", () => resolve())
    })
    let now = 0

    const testClock: Clock.Clock = {
      currentTimeMillisUnsafe: () => now,
      currentTimeMillis: Effect.sync(() => now),
      monotonicTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      monotonicTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
      currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
      sleep: (duration) =>
        Effect.sync(() => {
          now += Duration.toMillis(duration)
        }),
    }

    try {
      const error = await Effect.runPromise(
        withExclusiveLock(
          pluginLockPath(stateDir),
          Effect.succeed("should-not-run"),
          40,
        ).pipe(
          Effect.provideService(Clock.Clock, testClock),
          Effect.flip,
        ),
      )

      expect(Predicate.isTagged("LockTimeout")(error)).toBe(true)
      expect(now).toBeGreaterThanOrEqual(40)
      expect(now).toBeLessThan(1_000)
    } finally {
      holder.kill("SIGKILL")
      await waitExit(holder)
    }
  }, 10_000)
})
