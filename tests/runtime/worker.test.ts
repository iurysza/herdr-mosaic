import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { PLUGIN_ID } from "../../src/ids.ts"
import { PluginPaths, pathsFromEnv } from "../../src/runtime/paths.ts"
import { readSocketGeneration, startRefreshWorker } from "../../src/runtime/worker.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"

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

describe("worker ownership", () => {
  test("the second owner exits 0 while the first still holds the generation lock", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mosaic-worker-"))
    const env = { ...process.env, HERDR_PLUGIN_STATE_DIR: stateDir }

    const first = spawn("bun", [join(import.meta.dir, "hold-worker.ts"), "sock:1:2:3", "2000"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    await new Promise<void>((resolve) => {
      first.stdout?.on("data", () => resolve())
    })

    const second = spawn("bun", [join(import.meta.dir, "hold-worker.ts"), "sock:1:2:3", "10"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    const result = await waitExit(second)
    expect(result.code).toBe(0)
    first.kill("SIGKILL")
    await waitExit(first)
  }, 10_000)

  test("generation uses realpath, device, inode, and ctime", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mosaic-worker-"))
    const socketPath = join(stateDir, "herdr.sock")
    const fake = new FakeHerdr(socketPath)
    await fake.listen()

    try {
      const key = readSocketGeneration(socketPath)
      expect(key.startsWith(`${socketPath}:`)).toBe(true)
      expect(key.split(":")).toHaveLength(4)
    } finally {
      await fake.close()
    }
  })

  test("start does not spawn without sidebar_installed", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mosaic-worker-"))
    const socketPath = join(stateDir, "herdr.sock")
    const fake = new FakeHerdr(socketPath)
    await fake.listen()

    const paths = PluginPaths.of(pathsFromEnv({
      HOME: stateDir,
      HERDR_PLUGIN_STATE_DIR: stateDir,
      HERDR_SOCKET_PATH: socketPath,
      HERDR_PLUGIN_ROOT: join(import.meta.dir, "..", ".."),
    }))

    try {
      const pid = await Effect.runPromise(
        startRefreshWorker(process.execPath, join(import.meta.dir, "..", "..", "src", "cli.ts")).pipe(
          Effect.provideService(PluginPaths, paths),
        ),
      )

      expect(pid).toBe(0)
    } finally {
      await fake.close()
    }
  })

  test("a detached worker is a new session and is cleaned up after SIGKILL", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mosaic-worker-"))
    const socketPath = join(stateDir, "herdr.sock")
    const fake = new FakeHerdr(socketPath)
    fake.on("plugin.list", () => ({
      plugins: [{
        plugin_id: PLUGIN_ID,
        enabled: true,
        plugin_root: join(import.meta.dir, "..", ".."),
      }],
    }))
    await fake.listen()
    writeFileSync(join(stateDir, "state.json"), JSON.stringify({ sidebar_installed: true }))
    const pluginRoot = join(import.meta.dir, "..", "..")

    const paths = PluginPaths.of(pathsFromEnv({
      HOME: stateDir,
      HERDR_PLUGIN_STATE_DIR: stateDir,
      HERDR_SOCKET_PATH: socketPath,
      HERDR_PLUGIN_ROOT: pluginRoot,
      HERDR_PLUGIN_CONFIG_DIR: join(stateDir, "config"),
      HERDR_CONFIG_PATH: join(stateDir, "config.toml"),
      HERDR_BIN_PATH: join(stateDir, "missing-herdr"),
    }))

    let pid = 0

    try {
      pid = await Effect.runPromise(
        startRefreshWorker(process.execPath, join(pluginRoot, "src", "cli.ts")).pipe(
          Effect.provideService(PluginPaths, paths),
        ),
      )
      expect(pid).toBeGreaterThan(0)

      const proc = Bun.spawn(["ps", "-o", "pid=,sid=", "-p", String(pid)], {
        stdout: "pipe",
        stderr: "pipe",
      })

      const text = (await new Response(proc.stdout).text()).trim()
      await proc.exited
      const parts = text.split(/\s+/).filter(Boolean)
      expect(parts[0]).toBe(String(pid))
      expect(parts[1]).toBeDefined()
      expect(parts[1]).not.toBe("")
    } finally {
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          // already gone
        }
      }

      await fake.close()
    }
  }, 10_000)
})
