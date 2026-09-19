import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { PLUGIN_ID } from "../../src/ids.ts"
import { PluginPaths, pathsFromEnv, type PluginPathValues } from "../../src/runtime/paths.ts"
import { rpcCall } from "../../src/runtime/rpc.ts"
import { herdrBin, startIsolatedHerdr } from "../support/isolated-herdr.ts"

const pluginRoot = join(import.meta.dir, "..", "..")

const USERS_REAL = `onboarding = false

[theme]
name = "gruvbox"
auto_switch = false
[ui]
agent_panel_sort = "priority"
sidebar_width = 34

[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"]]
`

async function run(argv: readonly string[], extraEnv: NodeJS.ProcessEnv) {
  const previous = { ...process.env }

  Object.assign(process.env, extraEnv)

  try {
    return await Effect.runPromise(runCli(argv).pipe(Effect.provide(PluginPaths.layer)))
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key]
    }

    Object.assign(process.env, previous)
  }
}

async function waitPing(paths: PluginPathValues) {
  const deadline = Date.now() + 10_000
  let last: unknown

  while (Date.now() < deadline) {
    try {
      return await Effect.runPromise(
        rpcCall("ping", {}, 500).pipe(Effect.provideService(PluginPaths, paths)),
      )
    } catch (error) {
      last = error
    }

    await Bun.sleep(50)
  }

  throw last instanceof Error ? last : new Error(`ping failed: ${String(last)}`)
}

describe("real Herdr install lifecycle", () => {
  test("install then uninstall restores config bytes", async () => {
    const bin = herdrBin()
    const isolated = startIsolatedHerdr(bin, { linkPluginRoot: pluginRoot })

    isolated.env.HERDR_BIN_PATH = bin
    isolated.env.MOSAIC_TEST_ISOLATED = "1"

    const paths = PluginPaths.of(pathsFromEnv({
      HOME: isolated.home,
      HERDR_SOCKET_PATH: isolated.socketPath,
      HERDR_CONFIG_PATH: isolated.configPath,
      HERDR_BIN_PATH: bin,
      HERDR_PLUGIN_ID: PLUGIN_ID,
      HERDR_PLUGIN_STATE_DIR: isolated.stateDir,
      HERDR_PLUGIN_ROOT: pluginRoot,
    }))

    try {
      await waitPing(paths)
      await Effect.runPromise(
        rpcCall("plugin.enable", { plugin_id: PLUGIN_ID }).pipe(
          Effect.provideService(PluginPaths, paths),
        ),
      )

      await Bun.write(isolated.configPath, USERS_REAL)

      const original = readFileSync(isolated.configPath, "utf8")
      const installed = await run(["install"], isolated.env)

      expect(installed.code, installed.stdout + installed.stderr).toBe(0)
      expect(readFileSync(isolated.configPath, "utf8")).toContain("$elapsed")

      const checked = Bun.spawn([bin, "config", "check"], {
        env: {
          ...isolated.env,
          PATH: `${dirname(bin)}:/usr/bin:/bin`,
        },
        stdout: "pipe",
        stderr: "pipe",
      })

      const checkOut = await new Response(checked.stdout).text()
      const checkErr = await new Response(checked.stderr).text()

      expect(await checked.exited, `${checkOut}\n${checkErr}`).toBe(0)

      const uninstalled = await run(["uninstall"], isolated.env)

      expect(uninstalled.code, uninstalled.stdout + uninstalled.stderr).toBe(0)
      expect(readFileSync(isolated.configPath, "utf8")).toBe(original)
    } finally {
      await isolated.stop()
    }
  }, 40_000)
})
