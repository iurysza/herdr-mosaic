import { readFileSync } from "node:fs"
import { dirname } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { herdrBin } from "../support/isolated-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

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

async function run(argv: readonly string[], extraEnv: { [key: string]: string }) {
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

describe("real Herdr config check", () => {
  test("accepts a TypeScript-installed sidebar template", async () => {
    const bin = herdrBin()
    const sandbox = makeSandbox()
    const configPath = sandbox.env.HERDR_CONFIG_PATH

    if (configPath === undefined) throw new Error("missing config path")

    sandbox.env.HERDR_BIN_PATH = bin
    await Bun.write(configPath, USERS_REAL)

    const installed = await run(["sidebar-install"], sandbox.env)

    expect(installed.code).toBe(0)
    expect(readFileSync(configPath, "utf8")).toContain("$elapsed")

    const checked = Bun.spawn([bin, "config", "check"], {
      env: {
        ...sandbox.env,
        HERDR_BIN_PATH: bin,
        HERDR_CONFIG_PATH: configPath,
        PATH: `${dirname(bin)}:/usr/bin:/bin`,
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(checked.stdout).text()
    const stderr = await new Response(checked.stderr).text()
    const code = await checked.exited

    expect(code, `${stdout}\n${stderr}`).toBe(0)
  }, 20_000)
})
