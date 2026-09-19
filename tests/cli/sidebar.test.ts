import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { load } from "../../src/state/store.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { allSlotTokens } from "../../src/spaces/palette.ts"
import { installFakeHerdr, makeSandbox } from "../support/sandbox.ts"

const USERS_REAL = `onboarding = false
# [ui]
# agent_panel_sort = "priority"

[theme]
# name = "one-dark"

name = "gruvbox"
auto_switch = false
[ui]
agent_panel_sort = "priority"
sidebar_width = 34

[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"]]


[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "herdr-file-viewer.open-file-viewer"
`

const ROWS_BY_AGENT = `[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.agents.rows_by_agent]
claude = [["state_icon", "workspace", "tab"], ["agent"]]
`

async function run(argv: readonly string[], extraEnv: Readonly<Record<string, string>> = {}) {
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

type SidebarSandbox = {
  readonly sandbox: ReturnType<typeof makeSandbox>
  readonly env: ReturnType<typeof makeSandbox>["env"]
}

function sandboxEnv(): SidebarSandbox {
  const sandbox = makeSandbox()
  const herdr = installFakeHerdr(sandbox)

  sandbox.env.HERDR_BIN_PATH = herdr

  return { sandbox, env: sandbox.env }
}

describe("sidebar CLI", () => {
  test("installs templates, is idempotent, and restores exact bytes", async () => {
    const { sandbox, env } = sandboxEnv()
    const configPath = env.HERDR_CONFIG_PATH

    if (configPath === undefined) throw new Error("missing config path")

    await Bun.write(configPath, USERS_REAL)

    const installed = await run(["sidebar-install"], env)

    expect(installed.code).toBe(0)
    expect(installed.stdout).toContain("installed tokens into 2 row set(s)")

    const afterInstall = readFileSync(configPath, "utf8")

    expect(afterInstall).toContain(`$${allSlotTokens()[0]}`)
    expect(afterInstall).toContain("$elapsed")
    expect(afterInstall).toContain("$themed_model_tier")
    expect(afterInstall).toContain("onboarding = false")
    expect(afterInstall).toContain("# name = \"one-dark\"")
    expect(afterInstall).not.toContain("[ui.sidebar.agents.rows_by_agent]")

    const state = load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json"))

    expect(state.sidebar_installed).toBe(true)
    expect(state.sidebar_backup).not.toBeNull()

    const repeat = await run(["sidebar-install"], env)

    expect(repeat.code).toBe(0)
    expect(repeat.stdout).toContain("sidebar already carries the plugin templates; nothing to do")
    expect(readFileSync(configPath, "utf8")).toBe(afterInstall)

    const removed = await run(["sidebar-remove"], env)

    expect(removed.code).toBe(0)
    expect(removed.stdout).toContain("restored")
    expect(readFileSync(configPath, "utf8")).toBe(USERS_REAL)

    const afterRemove = load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json"))

    expect(afterRemove.sidebar_installed).toBe(false)
    expect(afterRemove.sidebar_backup).toBeNull()
    expect(sandbox.root.startsWith("/tmp/")).toBe(true)
  })

  test("remove skips a user-modified owned key without --force", async () => {
    const { env } = sandboxEnv()
    const configPath = env.HERDR_CONFIG_PATH

    if (configPath === undefined) throw new Error("missing config path")

    await Bun.write(configPath, USERS_REAL)
    expect((await run(["sidebar-install"], env)).code).toBe(0)

    const live = readFileSync(configPath, "utf8")
    await Bun.write(configPath, live.replace("$elapsed", "$elapsed_user"))

    const removed = await run(["sidebar-remove"], env)

    expect(removed.code).toBe(0)
    expect(removed.stderr).toContain("ui.sidebar.agents.rows changed outside the plugin")
    expect(readFileSync(configPath, "utf8")).toContain("$elapsed_user")
    expect(readFileSync(configPath, "utf8")).not.toContain("$sd_rose")
  })

  test("remove --force restores a user-modified owned key", async () => {
    const { env } = sandboxEnv()
    const configPath = env.HERDR_CONFIG_PATH

    if (configPath === undefined) throw new Error("missing config path")

    await Bun.write(configPath, USERS_REAL)
    expect((await run(["sidebar-install"], env)).code).toBe(0)

    const live = readFileSync(configPath, "utf8")
    await Bun.write(configPath, live.replace("$elapsed", "$elapsed_user"))

    const forced = await run(["sidebar-remove", "--force"], env)

    expect(forced.code).toBe(0)
    expect(forced.stdout).toContain("restored")
    expect(readFileSync(configPath, "utf8")).toBe(USERS_REAL)
  })

  test("preserves rows_by_agent through CLI install", async () => {
    const { env } = sandboxEnv()
    const configPath = env.HERDR_CONFIG_PATH

    if (configPath === undefined) throw new Error("missing config path")

    await Bun.write(configPath, ROWS_BY_AGENT)
    const result = await run(["sidebar-install"], env)

    expect(result.code).toBe(0)

    const written = readFileSync(configPath, "utf8")
    const originalTail = ROWS_BY_AGENT.split("[ui.sidebar.agents.rows_by_agent]")[1] ?? ""

    expect(written).toContain("[ui.sidebar.agents.rows_by_agent]")
    expect(written).toContain(originalTail.trim())
    expect(written).toContain('claude = [["state_icon", "workspace", "tab"], ["agent"]]')
  })

  test("remove without a backup is a noop", async () => {
    const { env } = sandboxEnv()
    const result = await run(["sidebar-remove"], env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("no sidebar backup recorded; nothing to remove")
  })

  test("tolerates a pre-existing diagnostic", async () => {
    const { env } = sandboxEnv()
    const configPath = env.HERDR_CONFIG_PATH

    if (configPath === undefined) throw new Error("missing config path")

    await Bun.write(configPath, '[theme]\nname = "gruvbox"\nlegacy_unknown_key = 1\n')

    const tolerated = await run(["sidebar-install"], env)

    expect(tolerated.code).toBe(0)
    expect(readFileSync(configPath, "utf8")).toContain("legacy_unknown_key = 1")
    expect(readFileSync(configPath, "utf8")).toContain(`$${allSlotTokens()[0]}`)
  })

  test("python reads typescript sidebar backup records", async () => {
    const { env } = sandboxEnv()
    const configPath = env.HERDR_CONFIG_PATH

    if (configPath === undefined) throw new Error("missing config path")

    await Bun.write(configPath, USERS_REAL)
    const result = await run(["sidebar-install"], env)

    expect(result.code).toBe(0)

    const proc = Bun.spawn(
      [
        "python3",
        "-c",
        "import os,sys; sys.path.insert(0, os.environ['HERDR_PLUGIN_ROOT']+'/src'); import state; st=state.load(); assert st['sidebar_installed'] is True; k=st['sidebar_backup']['keys']; assert k['ui.sidebar.spaces.rows']['present'] is True; assert isinstance(k['ui.sidebar.spaces.rows']['value'], list); assert k['ui.sidebar.agents.rows']['present'] is True; print('ok')",
      ],
      { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" },
    )

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited

    expect(stderr).toBe("")
    expect(code).toBe(0)
    expect(stdout.trim()).toBe("ok")
  })
})
