import { join } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { PLUGIN_ID } from "../../src/ids.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { defaultState, load, save } from "../../src/state/store.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { installFakeHerdr, makeSandbox } from "../support/sandbox.ts"

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

const ROWS_BY_AGENT = `[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.agents.rows_by_agent]
claude = [["state_icon", "workspace", "tab"], ["agent"]]
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

function required(env: { [key: string]: string }, key: string): string {
  const value = env[key]

  if (value === undefined || value === "") throw new Error(`missing ${key}`)

  return value
}

function attachRpc(fake: FakeHerdr) {
  fake.on("ping", () => ({ version: "0.9.0", protocol: 22 }))
  fake.on("workspace.list", () => ({ workspaces: [] }))
  fake.on("agent.list", () => ({ agents: [{ pane_id: "w1:p1", workspace_id: "w1" }] }))
  fake.on("server.reload_config", () => ({ status: "applied", diagnostics: [] }))
  fake.on("agent.view.set", (_method, params) => ({
    active: true,
    source: PLUGIN_ID,
    label: params.label ?? "Spaces",
  }))
  fake.on("agent.view.clear", () => ({ active: false }))
  fake.on("workspace.report_metadata", () => ({}))
  fake.on("pane.report_metadata", () => ({}))
  fake.on("client.window_title.clear", () => ({}))
  fake.on("pane.get", () => ({ pane: { tokens: {} } }))
  fake.on("tab.list", () => ({ tabs: [] }))
}

function lifecycleEnv() {
  const sandbox = makeSandbox()
  const herdr = installFakeHerdr(sandbox)

  sandbox.env.HERDR_BIN_PATH = herdr
  const socketPath = required(sandbox.env, "HERDR_SOCKET_PATH")
  const fake = new FakeHerdr(socketPath)

  attachRpc(fake)
  writeFileSync(required(sandbox.env, "HERDR_CONFIG_PATH"), USERS_REAL)

  return { sandbox, env: sandbox.env, fake, configPath: required(sandbox.env, "HERDR_CONFIG_PATH") }
}

describe("install CLI", () => {
  test("dry-run only previews migrate and does not write sidebar or state", async () => {
    const sandbox = makeSandbox()
    const herdr = installFakeHerdr(sandbox)

    sandbox.env.HERDR_BIN_PATH = herdr
    const env = sandbox.env
    const chromatic = required(env, "HERDR_LEGACY_CHROMATIC_STATE_DIR")

    mkdirSync(chromatic, { recursive: true })
    writeFileSync(
      join(chromatic, "state.json"),
      JSON.stringify({ identities: { w1: { colour: "#7fd6c1", origin: "manual" } } }),
    )

    const configPath = required(env, "HERDR_CONFIG_PATH")

    writeFileSync(configPath, USERS_REAL)

    const result = await run(["install", "--dry-run"], env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("install --dry-run only previews migrate")
    expect(readFileSync(configPath, "utf8")).toBe(USERS_REAL)
    expect(existsSync(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))).toBe(false)
  })

  test("install keeps migrated view_mode", async () => {
    const { env, fake } = lifecycleEnv()
    const chromatic = required(env, "HERDR_LEGACY_CHROMATIC_STATE_DIR")

    mkdirSync(chromatic, { recursive: true })
    writeFileSync(
      join(chromatic, "state.json"),
      JSON.stringify({ view_mode: "current", identities: {} }),
    )

    await fake.listen()

    try {
      const result = await run(["install"], env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("agent focus: current")

      const view = fake.requests.filter((request) => request.method === "agent.view.set")

      expect(view.length).toBeGreaterThanOrEqual(1)
      expect(view[0]?.params.filter).toBeDefined()
      expect(load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")).view_mode).toBe("current")
      expect(fake.requests.some((request) => request.method === "plugin.list")).toBe(true)
    } finally {
      await fake.close()
    }
  })

  test("install then uninstall restores config bytes and keeps identities", async () => {
    const { env, fake, configPath } = lifecycleEnv()
    const original = readFileSync(configPath, "utf8")
    const statePath = join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    await fake.listen()

    try {
      expect((await run(["install"], env)).code).toBe(0)

      const installed = load(statePath)

      expect(installed.sidebar_installed).toBe(true)
      expect(installed.view_installed).toBe(true)
      expect(installed.identities).toEqual({})

      installed.identities = { w1: { colour: "#7aa2f7", origin: "manual" } }
      save(statePath, installed)

      const uninstalled = await run(["uninstall"], env)

      expect(uninstalled.code).toBe(0)
      expect(uninstalled.stdout).toContain("restored.")
      expect(readFileSync(configPath, "utf8")).toBe(original)
      expect(load(statePath).sidebar_backup).toBeNull()
      expect(load(statePath).identities.w1).toEqual({ colour: "#7aa2f7", origin: "manual" })

      const metadata = fake.requests.filter((request) => request.method === "pane.report_metadata")

      for (const request of metadata) {
        const source = request.params.source

        expect(source).not.toBe("themed_model_tier")
        expect(JSON.stringify(request.params.tokens)).not.toContain("themed_model_tier")
      }
    } finally {
      await fake.close()
    }
  })
})

describe("doctor CLI", () => {
  test("always exits 0 and warns that rows_by_agent hides the template", async () => {
    const sandbox = makeSandbox()
    const herdr = installFakeHerdr(sandbox)

    sandbox.env.HERDR_BIN_PATH = herdr
    writeFileSync(required(sandbox.env, "HERDR_CONFIG_PATH"), ROWS_BY_AGENT)

    const result = await run(["doctor"], sandbox.env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("ui.sidebar.agents.rows_by_agent.claude")
    expect(result.stdout).toContain("fully replaces")
    expect(result.stdout).toContain("Problems")
  })

  test("warns when the agents row exceeds sixteen tokens", async () => {
    const sandbox = makeSandbox()
    const herdr = installFakeHerdr(sandbox)
    const tokens = Array.from({ length: 17 }, (_, index) => `"t${index}"`).join(", ")

    sandbox.env.HERDR_BIN_PATH = herdr
    writeFileSync(
      required(sandbox.env, "HERDR_CONFIG_PATH"),
      `[ui.sidebar.agents]\nrows = [[${tokens}]]\n`,
    )

    const result = await run(["doctor"], sandbox.env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Agents row has 17 tokens; Herdr max is 16.")
  })
})

describe("agent view CLI", () => {
  test("view current and view-clear round-trip", async () => {
    const { env, fake } = lifecycleEnv()

    await fake.listen()

    try {
      const installed = await run(["view", "current"], env)

      expect(installed.code).toBe(0)
      expect(installed.stdout).toContain("agent focus: current; sort: spaces (Spaces)")
      expect(load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")).view_installed).toBe(true)

      const cleared = await run(["view-clear"], env)

      expect(cleared.code).toBe(0)
      expect(cleared.stdout).toContain("agent view cleared")
      expect(load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")).view_installed).toBe(false)
    } finally {
      await fake.close()
    }
  })

  test("scope and sort axes are independent", async () => {
    const { env, fake } = lifecycleEnv()

    await fake.listen()

    try {
      expect((await run(["view", "all"], env)).code).toBe(0)
      expect((await run(["sort", "activity"], env)).code).toBe(0)
      expect((await run(["toggle-agent-focus"], env)).code).toBe(0)

      const state = load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))

      expect(state.view_mode).toBe("current")
      expect(state.sort_mode).toBe("activity")

      const last = fake.requests.filter((request) => request.method === "agent.view.set").at(-1)

      expect(last?.params.label).toBe("Activity")
      expect(last?.params.filter).toBeDefined()
    } finally {
      await fake.close()
    }
  })

  test("view install failure does not persist", async () => {
    const { env, fake } = lifecycleEnv()

    fake.on("agent.view.set", () => ({
      error: { code: "invalid_agent_view", message: "nope" },
    }))

    await fake.listen()

    try {
      const result = await run(["toggle-agent-focus"], env)

      expect(result.code).toBe(1)

      const state = load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))

      expect(state.view_mode).not.toBe("current")
      expect(state.sort_mode).toBe("spaces")
      expect(state.view_installed).toBe(false)
    } finally {
      await fake.close()
    }
  })

  test("reconcile reapplies both view axes", async () => {
    const { env, fake } = lifecycleEnv()
    const statePath = join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.view_installed = true
    state.view_mode = "current"
    state.sort_mode = "activity"
    save(statePath, state)

    await fake.listen()

    try {
      expect((await run(["reconcile"], env)).code).toBe(0)

      const view = fake.requests.filter((request) => request.method === "agent.view.set")

      expect(view.length).toBe(1)
      expect(view[0]?.params.label).toBe("Activity")
      expect(view[0]?.params.filter).toBeDefined()
    } finally {
      await fake.close()
    }
  })

  test("reconcile republishes workspace and pane metadata after loss", async () => {
    const { env, fake } = lifecycleEnv()
    const statePath = join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.identities = { w1: { colour: "#7aa2f7", origin: "manual" } }
    save(statePath, state)
    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w1", number: 1, label: "Website" }],
    }))
    fake.on("agent.list", () => ({
      agents: [{ pane_id: "w1:p1", workspace_id: "w1" }],
    }))

    await fake.listen()

    try {
      expect((await run(["reconcile"], env)).code).toBe(0)

      const spaces = fake.requests.filter((request) => request.method === "workspace.report_metadata")
      const panes = fake.requests.filter((request) => request.method === "pane.report_metadata")

      expect(spaces.some((request) => request.params.workspace_id === "w1")).toBe(true)
      expect(panes.some((request) => request.params.pane_id === "w1:p1")).toBe(true)
    } finally {
      await fake.close()
    }
  })

  test("second ownership cycle restores the current pre-plugin rows", async () => {
    const { env, fake, configPath } = lifecycleEnv()

    const cycleA = [
      "[ui.sidebar.agents]",
      'rows = [["state_icon", "workspace", "tab"], ["agent"]]',
      "",
      "[ui.sidebar.spaces]",
      'rows = [["state_icon", "workspace"], ["branch", "git_status"]]',
      "",
    ].join("\n")

    const cycleB = [
      "[ui.sidebar.agents]",
      'rows = [["state_icon", "agent"]]',
      "",
      "[ui.sidebar.spaces]",
      'rows = [["state_icon", "workspace"], ["branch", "git_status"]]',
      "",
    ].join("\n")

    const statePath = join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    writeFileSync(configPath, cycleA)
    await fake.listen()

    try {
      expect((await run(["install"], env)).code).toBe(0)

      const first = load(statePath)

      expect(first.sidebar_backup).not.toBeNull()
      expect((await run(["uninstall"], env)).code).toBe(0)
      expect(load(statePath).sidebar_backup).toBeNull()
      expect(load(statePath).ownership_baseline).toBeNull()
      expect(load(statePath).last_written).toEqual({})
      writeFileSync(configPath, cycleB)
      expect((await run(["install"], env)).code).toBe(0)

      const second = load(statePath)

      expect(JSON.stringify(second.sidebar_backup)).toContain('["state_icon","agent"]')
      expect(JSON.stringify(second.ownership_baseline)).toContain('["state_icon","agent"]')
      expect((await run(["uninstall"], env)).code).toBe(0)
      expect(readFileSync(configPath, "utf8")).toBe(cycleB)
    } finally {
      await fake.close()
    }
  })
})
