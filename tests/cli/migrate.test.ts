import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect, Result, Schema } from "effect"

import { runCli } from "../../src/cli.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { defaultState, load, save } from "../../src/state/store.ts"
import { makeSandbox } from "../support/sandbox.ts"

async function run(argv: readonly string[], env: { [key: string]: string }) {
  const previous = { ...process.env }

  Object.assign(process.env, env)

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

function write(directory: string, name: string, text: string): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)

  writeFileSync(path, text)

  return path
}

function read(path: string): string {
  return readFileSync(path, "utf8")
}

function seedWindowManager(
  env: { [key: string]: string },
  extraText: string,
): string {
  const state = defaultState()
  const parsed: unknown = JSON.parse(extraText)
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

  if (Result.isSuccess(decoded)) Object.assign(state, decoded.success)

  const text = `${JSON.stringify(state, null, 4)}\n`

  write(required(env, "HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR"), "state.json", text)
  mkdirSync(required(env, "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR"), { recursive: true })

  return text
}

describe("migrate Window Manager", () => {
  test("copies state, settings, rules, and backups byte-exactly", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env

    const original = seedWindowManager(env, JSON.stringify({
      identities: { w1: { colour: "#7aa2f7", origin: "manual" } },
      agent_settled: { "w1:p1": { status: "idle", last_settled_at: 123 } },
      view_mode: "current",
      theme_backup: { keys: { "ui.accent": { present: false } } },
      future_field: { keep: true },
    }))

    const files = {
      "settings.json": "{\r\n  \"intensity\": \"bold\", \"marker\": \"◆\"\r\n}\r\n",
      "identities.json": "{\"version\": 1, \"identities\": {\"API\": \"sage\"}}\n",
      "legacy-layouts-settings.json": "{\"keep\": true}\n",
    }

    const oldConfig = required(env, "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR")

    for (const [name, text] of Object.entries(files)) {
      write(oldConfig, name, text)
    }

    const snapshot = "# before Window Manager\r\n[theme]\r\nname = \"gruvbox\"\r\n"
    const backupName = "config.backup.20260908-004032.toml"

    write(required(env, "HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR"), backupName, snapshot)
    writeFileSync(required(env, "HERDR_CONFIG_PATH"), "users_real\n")

    const beforeConfig = read(required(env, "HERDR_CONFIG_PATH"))
    const result = await run(["migrate"], env)

    expect(result.code).toBe(0)
    expect(read(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))).toBe(original)
    expect(read(join(required(env, "HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR"), "state.json"))).toBe(original)
    expect(read(join(required(env, "HERDR_PLUGIN_STATE_DIR"), backupName))).toBe(snapshot)
    expect(read(required(env, "HERDR_CONFIG_PATH"))).toBe(beforeConfig)

    for (const [name, text] of Object.entries(files)) {
      expect(read(join(required(env, "HERDR_PLUGIN_CONFIG_DIR"), name))).toBe(text)
      expect(read(join(oldConfig, name))).toBe(text)
    }
  })

  test("existing Mosaic state wins on repeat even with --force", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env

    seedWindowManager(env, JSON.stringify({ view_mode: "current" }))
    expect((await run(["migrate"], env)).code).toBe(0)

    const statePath = join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const current = load(statePath)

    current.view_mode = "all"
    save(statePath, current)

    const before = read(statePath)

    seedWindowManager(env, JSON.stringify({ view_mode: "current", tint_enabled: true }))
    expect((await run(["migrate", "--force"], env)).code).toBe(0)
    expect(read(statePath)).toBe(before)
  })

  test("Chromatic cannot override Window Manager on import or repeat", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env

    seedWindowManager(env, JSON.stringify({
      identities: { w1: { colour: "#7aa2f7", origin: "manual" } },
    }))
    write(required(env, "HERDR_LEGACY_CHROMATIC_STATE_DIR"), "state.json", JSON.stringify({
      identities: { w1: { colour: "#a6d189", origin: "manual" } },
      sidebar_backup: { keys: { "ui.sidebar.agents.rows": { present: false } } },
    }))

    expect((await run(["migrate"], env)).code).toBe(0)
    expect((await run(["migrate", "--force"], env)).code).toBe(0)

    const state = load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))

    expect(state.identities.w1).toEqual({ colour: "#7aa2f7", origin: "manual" })
    expect(state.sidebar_backup).toBeNull()
  })

  test("removing the Window Manager source does not re-enable Chromatic import", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env
    const wmState = required(env, "HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR")

    seedWindowManager(env, JSON.stringify({
      identities: { w1: { colour: "#7aa2f7", origin: "manual" } },
    }))
    expect((await run(["migrate"], env)).code).toBe(0)

    unlinkSync(join(wmState, "state.json"))
    write(required(env, "HERDR_LEGACY_CHROMATIC_STATE_DIR"), "state.json", JSON.stringify({
      identities: { w1: { colour: "#a6d189", origin: "manual" } },
    }))

    expect((await run(["migrate", "--force"], env)).code).toBe(0)
    expect(load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")).identities.w1)
      .toEqual({ colour: "#7aa2f7", origin: "manual" })
  })

  test("dry-run does not copy data or change config", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env

    seedWindowManager(env, "{}")
    write(required(env, "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR"), "settings.json", "{\"intensity\": \"bold\"}\n")
    writeFileSync(required(env, "HERDR_CONFIG_PATH"), "keep\n")

    const before = read(required(env, "HERDR_CONFIG_PATH"))
    const result = await run(["migrate", "--dry-run"], env)

    expect(result.code).toBe(0)
    expect(existsSync(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))).toBe(false)
    expect(existsSync(join(required(env, "HERDR_PLUGIN_CONFIG_DIR"), "settings.json"))).toBe(false)
    expect(read(required(env, "HERDR_CONFIG_PATH"))).toBe(before)
  })

  test("conflicting files fail before any copy even with --force", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env

    seedWindowManager(env, "{}")
    write(required(env, "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR"), "settings.json", "{\"intensity\": \"bold\"}\n")
    write(required(env, "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR"), "identities.json", "{\"version\": 1}\n")

    const conflict = write(required(env, "HERDR_PLUGIN_CONFIG_DIR"), "identities.json", "{\"version\": 2}\n")
    const result = await run(["migrate", "--force"], env)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("existing Mosaic files are never overwritten")
    expect(existsSync(join(required(env, "HERDR_PLUGIN_CONFIG_DIR"), "settings.json"))).toBe(false)
    expect(existsSync(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))).toBe(false)
    expect(read(conflict)).toBe("{\"version\": 2}\n")
  })

  test("equal files allow retry after an interrupted copy", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env
    const text = "{\"marker\": \"◆\"}\n"

    seedWindowManager(env, "{}")
    write(required(env, "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR"), "settings.json", text)
    write(required(env, "HERDR_PLUGIN_CONFIG_DIR"), "settings.json", text)

    expect((await run(["migrate"], env)).code).toBe(0)
    expect(read(join(required(env, "HERDR_PLUGIN_CONFIG_DIR"), "settings.json"))).toBe(text)
  })

  test("unreadable or unsupported source does not create state", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env
    const wmState = required(env, "HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR")

    mkdirSync(required(env, "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR"), { recursive: true })

    for (const text of ["not json", "[]", "null", "{\"version\": 999}"]) {
      write(wmState, "state.json", text)

      const result = await run(["migrate"], env)

      expect(result.code).toBe(1)
      expect(existsSync(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))).toBe(false)
    }
  })
})

describe("migrate Chromatic", () => {
  test("imports identities and ignores stale backups", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env

    writeFileSync(required(env, "HERDR_CONFIG_PATH"), `[ui.sidebar.agents]\nrows = [["state_icon"]]\n`)
    write(required(env, "HERDR_LEGACY_CHROMATIC_STATE_DIR"), "state.json", JSON.stringify({
      identities: {
        w1: { colour: "#7fd6c1", origin: "manual" },
        w2: { colour: "#a6d189", origin: "auto" },
      },
      alloc_cursor: 4,
      sidebar_backup: { keys: { "ui.sidebar.agents.rows": { present: false } } },
      theme_backup: { keys: { "ui.accent": { present: false } } },
      last_written: { "ui.sidebar.agents.rows": [["state_icon", "$sd_rose"]] },
      tint_enabled: true,
    }))

    const result = await run(["migrate"], env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("ignored stale Chromatic backups:")
    expect(result.stdout).toContain("sidebar_backup")
    expect(result.stdout).toContain("not auto-enabling")

    const state = load(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))

    expect(state.identities.w1).toEqual({ colour: "#7fd6c1", origin: "manual" })
    expect(state.identities.w2).toEqual({ colour: "#a6d189", origin: "auto" })
    expect(state.theme_backup).toBeNull()
    expect(state.tint_enabled).toBe(false)
    expect(state.alloc_cursor).toBe(4)
    expect(state.last_written).toEqual({})
    expect(state.sidebar_backup).not.toBeNull()

    const backup = Schema.decodeUnknownResult(Schema.JsonObject)(state.sidebar_backup)

    expect(Result.isSuccess(backup)).toBe(true)

    if (Result.isSuccess(backup)) {
      const keys = Schema.decodeUnknownResult(Schema.JsonObject)(backup.success.keys ?? null)

      expect(Result.isSuccess(keys)).toBe(true)

      if (Result.isSuccess(keys)) {
        const row = Schema.decodeUnknownResult(Schema.JsonObject)(
          keys.success["ui.sidebar.agents.rows"] ?? null,
        )

        expect(Result.isSuccess(row) && row.success.present).toBe(true)
      }
    }
  })

  test("conflict fails without --force and overlays with --force", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env
    const statePath = join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const st = defaultState()

    st.identities.w1 = { colour: "#fab387", origin: "manual" }
    save(statePath, st)
    write(required(env, "HERDR_LEGACY_CHROMATIC_STATE_DIR"), "state.json", JSON.stringify({
      identities: { w1: { colour: "#7fd6c1", origin: "manual" } },
    }))

    const blocked = await run(["migrate"], env)

    expect(blocked.code).toBe(1)
    expect(blocked.stderr).toContain("identity conflicts")
    expect(load(statePath).identities.w1).toEqual({ colour: "#fab387", origin: "manual" })

    const forced = await run(["migrate", "--force"], env)

    expect(forced.code).toBe(0)
    expect(load(statePath).identities.w1).toEqual({ colour: "#7fd6c1", origin: "manual" })
  })

  test("dry-run does not write Chromatic identities", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env

    write(required(env, "HERDR_LEGACY_CHROMATIC_STATE_DIR"), "state.json", JSON.stringify({
      identities: { w1: { colour: "#7fd6c1", origin: "manual" } },
    }))

    const result = await run(["migrate", "--dry-run"], env)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).dry_run).toBe(true)
    expect(existsSync(join(required(env, "HERDR_PLUGIN_STATE_DIR"), "state.json"))).toBe(false)
  })

  test("copies settings, label rules, and layouts settings", async () => {
    const sandbox = makeSandbox()
    const env = sandbox.env
    const rules = join(sandbox.root, "rules.json")

    write(required(env, "HERDR_LEGACY_CHROMATIC_CONFIG_DIR"), "settings.json", JSON.stringify({
      intensity: "bold",
      marker: "X",
    }))
    writeFileSync(rules, JSON.stringify({ version: 1, identities: { agents: "#a6d189" } }))
    write(required(env, "HERDR_LEGACY_LAYOUTS_CONFIG_DIR"), "settings.json", JSON.stringify({
      note: "from-layouts",
    }))

    const isolated = { ...env, HERDR_LABEL_IDENTITIES_FILE: rules }
    const result = await run(["migrate"], isolated)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).settings_copied).toBe(true)
    expect(JSON.parse(result.stdout).label_rules_copied).toBe(true)
    expect(JSON.parse(result.stdout).layouts_settings_copied).toBe(true)
    expect(JSON.parse(read(join(required(env, "HERDR_PLUGIN_CONFIG_DIR"), "settings.json"))).intensity)
      .toBe("bold")
    expect(JSON.parse(read(join(required(env, "HERDR_PLUGIN_CONFIG_DIR"), "identities.json"))).identities.agents)
      .toBe("#a6d189")
  })
})
