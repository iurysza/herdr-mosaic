import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { PLUGIN_ID } from "../../src/ids.ts"
import { PluginPaths, pathsFromEnv, type PluginPathValues } from "../../src/runtime/paths.ts"
import { rpcCall } from "../../src/runtime/rpc.ts"
import { herdrBin, startIsolatedHerdr } from "../support/isolated-herdr.ts"

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
      await Bun.sleep(50)
    }
  }

  throw last instanceof Error ? last : new Error(`ping failed: ${String(last)}`)
}

describe("real Herdr transport", () => {
  test("ping and plugin.list work on a disposable server", async () => {
    expect(process.env.HERDR_BIN_PATH?.includes("missing-herdr")).toBe(true)

    const bin = herdrBin()

    expect(bin.includes("missing-herdr")).toBe(false)

    const version = Bun.spawn([bin, "--version"], {
      env: { HOME: "/tmp", HERDR_CONFIG_PATH: "/tmp/mosaic-herdr-version.toml" },
      stdout: "pipe",
      stderr: "pipe",
    })

    const versionText = (await new Response(version.stdout).text()).trim()
    expect(await version.exited).toBe(0)
    expect(versionText).toContain("herdr 0.9.0")

    const isolated = startIsolatedHerdr(bin)

    const paths = PluginPaths.of(pathsFromEnv({
      HOME: isolated.home,
      HERDR_SOCKET_PATH: isolated.socketPath,
      HERDR_CONFIG_PATH: isolated.configPath,
      HERDR_BIN_PATH: bin,
      HERDR_PLUGIN_ID: PLUGIN_ID,
      HERDR_PLUGIN_STATE_DIR: isolated.stateDir,
      HERDR_PLUGIN_ROOT: isolated.env.HERDR_PLUGIN_ROOT ?? "",
    }))

    try {
      const ping = await waitPing(paths)
      expect(ping).toBeDefined()

      const listed = await Effect.runPromise(
        rpcCall("plugin.list", { plugin_id: PLUGIN_ID }).pipe(
          Effect.provideService(PluginPaths, paths),
        ),
      )

      expect(listed).toBeDefined()

      await expect(
        Effect.runPromise(
          rpcCall("nope.not.a.method", {}, 1_000).pipe(Effect.provideService(PluginPaths, paths)),
        ),
      ).rejects.toThrow()
    } finally {
      await isolated.stop()
    }
  }, 20_000)
})
