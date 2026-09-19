import { join } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { loadDoc } from "../../src/config/patch.ts"
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

const EXISTING_THEME = `[theme]
name = "nord"

[theme.custom]
# I like this pink
accent = "#f5c2e7"
red = "#ff6188"

[ui]
accent = "cyan"
`

const WORKSPACES = [
  { workspace_id: "w1", number: 1, label: "Website", focused: true },
  { workspace_id: "w2", number: 2, label: "API", focused: false },
]

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

function tintEnv(config = USERS_REAL) {
  const sandbox = makeSandbox()
  const herdr = installFakeHerdr(sandbox)

  sandbox.env.HERDR_BIN_PATH = herdr
  const socketPath = required(sandbox.env, "HERDR_SOCKET_PATH")
  const fake = new FakeHerdr(socketPath)
  const workspaces = WORKSPACES.map((workspace) => ({ ...workspace }))

  fake.on("workspace.list", () => ({ workspaces }))
  fake.on("agent.list", () => ({ agents: [] }))
  fake.on("server.reload_config", () => ({ status: "applied", diagnostics: [] }))
  fake.on("workspace.report_metadata", () => ({}))
  fake.on("pane.report_metadata", () => ({}))
  fake.on("client.window_title.set", () => ({}))
  fake.on("client.window_title.clear", () => ({}))
  fake.on("tab.list", () => ({ tabs: [] }))

  writeFileSync(required(sandbox.env, "HERDR_CONFIG_PATH"), config)

  const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
  const state = defaultState()

  state.identities = {
    w1: { colour: "#4f8cff", origin: "manual" },
    w2: { colour: "#a970ff", origin: "manual" },
  }
  save(statePath, state)

  return {
    sandbox,
    env: sandbox.env,
    fake,
    workspaces,
    configPath: required(sandbox.env, "HERDR_CONFIG_PATH"),
    statePath,
  }
}

function reloadCount(fake: FakeHerdr): number {
  return fake.requests.filter((request) => request.method === "server.reload_config").length
}

describe("tint CLI", () => {
  test("first apply writes and reloads once; duplicate enable is a noop", async () => {
    const { env, fake, configPath } = tintEnv()

    await fake.listen()

    try {
      const first = await run(["tint-enable"], env)

      expect(first.code).toBe(0)
      expect(first.stdout).toContain("tint enabled; applied for w1")
      expect(reloadCount(fake)).toBe(1)
      expect(readFileSync(configPath, "utf8")).not.toBe(USERS_REAL)

      const second = await run(["tint-enable"], env)

      expect(second.code).toBe(0)
      expect(second.stdout).toContain("tint enabled; noop for w1")
      expect(reloadCount(fake)).toBe(1)
    } finally {
      await fake.close()
    }
  })

  test("genuine space change writes again", async () => {
    const { env, fake, workspaces } = tintEnv()

    await fake.listen()

    try {
      expect((await run(["tint-enable"], env)).code).toBe(0)
      expect(reloadCount(fake)).toBe(1)

      const first = workspaces[0]
      const nextSpace = workspaces[1]

      if (first !== undefined) first.focused = false

      if (nextSpace !== undefined) nextSpace.focused = true

      const switched = await run(["tint-enable"], env)

      expect(switched.code).toBe(0)
      expect(switched.stdout).toContain("tint enabled; applied for w2")
      expect(reloadCount(fake)).toBe(2)
    } finally {
      await fake.close()
    }
  })

  test("tint does not write semantic colours", async () => {
    const { env, fake, configPath, statePath } = tintEnv(EXISTING_THEME)

    await fake.listen()

    try {
      expect((await run(["tint-enable"], env)).code).toBe(0)
      expect(loadDoc(configPath).get(["theme", "custom", "red"])).toBe("#ff6188")

      const written = load(statePath).last_written

      expect(JSON.stringify(written)).not.toContain("theme.custom.red")
    } finally {
      await fake.close()
    }
  })

  test("tint then restore is byte-exact", async () => {
    const { env, fake, configPath } = tintEnv()
    const original = readFileSync(configPath, "utf8")

    await fake.listen()

    try {
      expect((await run(["tint-enable"], env)).code).toBe(0)
      expect(readFileSync(configPath, "utf8")).not.toBe(original)

      const disabled = await run(["tint-disable"], env)

      expect(disabled.code).toBe(0)
      expect(disabled.stdout).toContain("tint disabled; restored")
      expect(readFileSync(configPath, "utf8")).toBe(original)
      expect(load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")).tint_enabled).toBe(false)
    } finally {
      await fake.close()
    }
  })

  test("conflict blocks overwrite and --force takes the keys", async () => {
    const { env, fake, configPath } = tintEnv()

    await fake.listen()

    try {
      expect((await run(["tint-enable"], env)).code).toBe(0)

      const doc = loadDoc(configPath)

      doc.set(["theme", "custom", "accent"], "#123456")
      writeFileSync(configPath, doc.dumps())

      const blocked = await run(["tint-enable"], env)

      expect(blocked.code).toBe(0)
      expect(blocked.stdout).toContain("tint enabled; conflict for w1")
      expect(blocked.stderr).toContain("not overwriting")
      expect(loadDoc(configPath).get(["theme", "custom", "accent"])).toBe("#123456")

      const forced = await run(["tint-enable", "--force"], env)

      expect(forced.code).toBe(0)
      expect(forced.stdout).toContain("tint enabled; applied for w1")
      expect(loadDoc(configPath).get(["theme", "custom", "accent"])).toBe("#4f8cff")
    } finally {
      await fake.close()
    }
  })

  test("theme-restore is tint-disable", async () => {
    const { env, fake, configPath } = tintEnv()
    const original = readFileSync(configPath, "utf8")

    await fake.listen()

    try {
      expect((await run(["tint-enable"], env)).code).toBe(0)
      expect((await run(["theme-restore"], env)).code).toBe(0)
      expect(readFileSync(configPath, "utf8")).toBe(original)
    } finally {
      await fake.close()
    }
  })

  test("no focused workspace still enables tint", async () => {
    const { env, fake, workspaces } = tintEnv()

    const first = workspaces[0]
    const second = workspaces[1]

    if (first !== undefined) first.focused = false

    if (second !== undefined) second.focused = false

    await fake.listen()

    try {
      const result = await run(["tint-enable"], env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("tint enabled (no focused workspace yet)")
      expect(load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")).tint_enabled).toBe(true)
    } finally {
      await fake.close()
    }
  })
})

describe("intensity, preview, marker, announce, list, state", () => {
  test("intensity without args prints the setting and does not enable tint", async () => {
    const { env, fake, statePath } = tintEnv()

    await fake.listen()

    try {
      const result = await run(["tint-intensity"], env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("intensity: medium")
      expect(result.stdout).toContain("choose one of: subtle, medium, bold")
      expect(load(statePath).tint_enabled).toBe(false)
    } finally {
      await fake.close()
    }
  })

  test("unknown intensity exits 1", async () => {
    const { env, fake } = tintEnv()

    await fake.listen()

    try {
      const result = await run(["intensity", "loud"], env)

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("unknown intensity 'loud'")
    } finally {
      await fake.close()
    }
  })

  test("preview prints swatches for the focused space", async () => {
    const { env, fake } = tintEnv()

    await fake.listen()

    try {
      const result = await run(["tint-preview"], env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("Website")
      expect(result.stdout).toContain("\x1b[48;2;")
      expect(result.stdout).toContain("(* = active)")
    } finally {
      await fake.close()
    }
  })

  test("marker presets and announce on", async () => {
    const { env, fake } = tintEnv()

    await fake.listen()

    try {
      const listed = await run(["marker"], env)

      expect(listed.code).toBe(0)
      expect(listed.stdout).toContain("dot")
      expect(listed.stdout).toContain("\u25cf")

      const set = await run(["marker", "ring"], env)

      expect(set.code).toBe(0)
      expect(set.stdout).toContain("marker: \u25c9")

      const tooLong = await run(["marker", "123456789"], env)

      expect(tooLong.code).toBe(1)
      expect(tooLong.stderr).toContain("too long")

      const announced = await run(["announce", "on"], env)

      expect(announced.code).toBe(0)
      expect(announced.stdout).toContain("announce: on")
      expect(announced.stdout).toContain("[ui.toast]")
    } finally {
      await fake.close()
    }
  })

  test("list and state print without mutating", async () => {
    const { env, fake, statePath, configPath } = tintEnv()
    const before = readFileSync(configPath, "utf8")
    const beforeState = readFileSync(statePath, "utf8")

    await fake.listen()

    try {
      const listed = await run(["list-colors"], env)

      expect(listed.code).toBe(0)
      expect(listed.stdout).toContain("Website")
      expect(listed.stdout).toContain("#4f8cff")
      expect(listed.stdout).toContain("<- focused")

      const dumped = await run(["state"], env)

      expect(dumped.code).toBe(0)
      expect(JSON.parse(dumped.stdout).identities.w1).toEqual({ colour: "#4f8cff", origin: "manual" })
      expect(readFileSync(configPath, "utf8")).toBe(before)
      expect(readFileSync(statePath, "utf8")).toBe(beforeState)
    } finally {
      await fake.close()
    }
  })

  test("repalette dry-run previews custom hex snaps", async () => {
    const { env, fake, statePath } = tintEnv()
    const state = load(statePath)

    state.identities = { w1: { colour: "#ff00aa", origin: "manual" } }
    save(statePath, state)

    await fake.listen()

    try {
      const result = await run(["repalette", "--dry-run"], env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("#ff00aa ->")
      expect(result.stdout).toContain("(dry run -- nothing changed)")
      expect(load(statePath).identities.w1).toEqual({ colour: "#ff00aa", origin: "manual" })
    } finally {
      await fake.close()
    }
  })

  test("reconcile reapplies tint when enabled", async () => {
    const { env, fake, statePath, configPath } = tintEnv()
    const original = readFileSync(configPath, "utf8")
    const state = load(statePath)

    state.tint_enabled = true
    save(statePath, state)

    await fake.listen()

    try {
      expect((await run(["reconcile"], env)).code).toBe(0)
      expect(readFileSync(configPath, "utf8")).not.toBe(original)
      expect(reloadCount(fake)).toBe(1)
      expect(fake.requests.some((request) => request.method === "client.window_title.set")).toBe(true)
    } finally {
      await fake.close()
    }
  })
})
