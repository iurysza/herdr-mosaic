import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { PluginPaths, pathsFromEnv, readProcessEnv } from "../../src/runtime/paths.ts"
import { makeSandbox } from "../support/sandbox.ts"

async function run(argv: readonly string[], extraEnv: Readonly<Record<string, string>> = {}) {
  const previous = { ...process.env }
  Object.assign(process.env, extraEnv)

  try {
    const layer = PluginPaths.layer

    return await Effect.runPromise(runCli(argv).pipe(Effect.provide(layer)))
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key]
    }

    Object.assign(process.env, previous)
  }
}

describe("CLI dispatcher", () => {
  test("prints help without dispatching", async () => {
    const result = await run([])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Space color:")
    expect(result.stdout).toContain("Tint:")
    expect(result.stdout).toContain("Agent view:")
    expect(result.stdout).toContain("Pane layouts:")
    expect(result.stdout).toContain("Advanced setup and maintenance:")
    expect(result.stdout).toContain("Internal hooks and recovery:")
    expect(result.stdout).toContain("pick-color -> set-identity")
  })

  test("help wins over a command name", async () => {
    const result = await run(["set-color", "-h"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("usage: main.py")
  })

  test("unknown command exits 2", async () => {
    const result = await run(["nosuch"])
    expect(result.code).toBe(2)
    expect(result.stderr).toBe("unknown command 'nosuch'\n")
  })

  test("wrong plugin id exits 1 before command work", async () => {
    const result = await run(["doctor"], { HERDR_PLUGIN_ID: "another.plugin" })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Mosaic cannot run as another.plugin")
  })

  test("aliases keep the plugin id guard", async () => {
    const result = await run(["pick-color"], { HERDR_PLUGIN_ID: "another.plugin" })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Mosaic cannot run as another.plugin")
  })

  test("pending window-manager import blocks non-migrate commands", async () => {
    const sandbox = makeSandbox()
    const wmState = sandbox.env.HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR ?? join(sandbox.root, "wm-state")

    mkdirSync(wmState, { recursive: true })
    writeFileSync(join(wmState, "state.json"), "{\"version\":1}\n")

    const result = await run(["doctor"], sandbox.env)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Compatible saved data awaits import")
  })

  test("migrate is allowed while window-manager import is pending", async () => {
    const sandbox = makeSandbox()
    const wmState = sandbox.env.HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR ?? join(sandbox.root, "wm-state")

    mkdirSync(wmState, { recursive: true })
    writeFileSync(join(wmState, "state.json"), "{\"version\":1}\n")

    const result = await run(["migrate"], sandbox.env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("window_manager_state_dir")
  })
})

describe("path defaults", () => {
  test("empty HERDR paths are treated as missing", () => {
    const env = pathsFromEnv({ HOME: "/tmp/mosaic-home" })
    expect(env.socketPath).toBe("/tmp/mosaic-home/.config/herdr/herdr.sock")
    expect(readProcessEnv().HERDR_PLUGIN_ID).toBe("iurysza.mosaic")
  })
})
