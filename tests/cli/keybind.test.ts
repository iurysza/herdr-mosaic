import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import {
  DEFAULT_IDLE_KEYBIND,
  DEFAULT_OLDEST_IDLE_KEYBIND,
  DEFAULT_PANE_MOVE_KEYBIND,
  DEFAULT_PRUNE_KEYBIND,
  DEFAULT_PROMOTE_PANE_KEYBIND,
  DEFAULT_SORT_KEYBIND,
  IDLE_NEXT_COMMAND,
  IDLE_OLDEST_COMMAND,
  NATIVE_NAV_BINDINGS,
  OWNED_IDLE_KEYBIND,
  PANE_MOVE_COMMAND,
  PRUNE_COMMAND,
  PROMOTE_PANE_COMMAND,
  SORT_TOGGLE_COMMAND,
} from "../../src/config/keybinds.ts"
import { keybindKey, nativeKeyValue } from "../../src/config/patch.ts"
import { TomlDoc } from "../../src/config/toml-edit.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { defaultState, load, save } from "../../src/state/store.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { installFakeHerdr, makeSandbox } from "../support/sandbox.ts"

const NO_SIDEBAR = `[theme]
name = "catppuccin"

[terminal]
default_shell = "/bin/zsh"
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

function sandboxEnv() {
  const sandbox = makeSandbox()
  const herdr = installFakeHerdr(sandbox)

  sandbox.env.HERDR_BIN_PATH = herdr

  const configPath = sandbox.env.HERDR_CONFIG_PATH

  if (configPath === undefined) throw new Error("missing config path")

  writeFileSync(configPath, NO_SIDEBAR)

  return { sandbox, env: sandbox.env, configPath }
}

describe("keybind CLI", () => {
  test("sort shortcut install and remove are reversible", async () => {
    const { env, configPath } = sandboxEnv()
    const installed = await run(["sort-keybind-install"], env)

    expect(installed.code).toBe(0)
    expect(keybindKey(TomlDoc.load(configPath), SORT_TOGGLE_COMMAND)).toBe(DEFAULT_SORT_KEYBIND)
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).sort_keybind_installed).toBe(true)

    const removed = await run(["sort-keybind-remove"], env)

    expect(removed.code).toBe(0)
    expect(keybindKey(TomlDoc.load(configPath), SORT_TOGGLE_COMMAND)).toBeUndefined()
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).sort_keybind_installed).toBe(false)
  })

  test("existing sort shortcut is not claimed", async () => {
    const { env, configPath } = sandboxEnv()

    writeFileSync(
      configPath,
      `${NO_SIDEBAR}\n[[keys.command]]\nkey = "prefix+shift+s"\n`
        + "type = \"plugin_action\"\n"
        + "command = \"iurysza.mosaic.toggle-agent-sort\"\n",
    )

    const result = await run(["sort-keybind-install"], env)

    expect(result.code).toBe(0)
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).sort_keybind_installed).toBe(false)
  })

  test("idle and prune keybindings are reversible", async () => {
    const { env, configPath } = sandboxEnv()

    expect((await run(["idle-keybind-install"], env)).code).toBe(0)
    expect((await run(["prune-keybind-install"], env)).code).toBe(0)
    expect(keybindKey(TomlDoc.load(configPath), IDLE_NEXT_COMMAND)).toBe(DEFAULT_IDLE_KEYBIND)
    expect(keybindKey(TomlDoc.load(configPath), PRUNE_COMMAND)).toBe(DEFAULT_PRUNE_KEYBIND)

    expect((await run(["idle-keybind-remove"], env)).code).toBe(0)
    expect((await run(["prune-keybind-remove"], env)).code).toBe(0)
    expect(keybindKey(TomlDoc.load(configPath), IDLE_NEXT_COMMAND)).toBeUndefined()
    expect(keybindKey(TomlDoc.load(configPath), PRUNE_COMMAND)).toBeUndefined()
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).idle_keybind_installed).toBe(false)
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).prune_keybind_installed).toBe(false)
  })

  test("pane move and promote shortcuts are reversible", async () => {
    const { env, configPath } = sandboxEnv()

    expect((await run(["pane-move-keybind-install"], env)).code).toBe(0)
    expect((await run(["promote-pane-keybind-install"], env)).code).toBe(0)
    expect(keybindKey(TomlDoc.load(configPath), PANE_MOVE_COMMAND)).toBe(DEFAULT_PANE_MOVE_KEYBIND)
    expect(keybindKey(TomlDoc.load(configPath), PROMOTE_PANE_COMMAND)).toBe(DEFAULT_PROMOTE_PANE_KEYBIND)

    expect((await run(["pane-move-keybind-remove"], env)).code).toBe(0)
    expect((await run(["promote-pane-keybind-remove"], env)).code).toBe(0)
    expect(keybindKey(TomlDoc.load(configPath), PANE_MOVE_COMMAND)).toBeUndefined()
    expect(keybindKey(TomlDoc.load(configPath), PROMOTE_PANE_COMMAND)).toBeUndefined()
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).pane_move_keybind_installed)
      .toBe(false)
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).promote_pane_keybind_installed)
      .toBe(false)
  })

  test("occupied shortcut is not replaced or claimed", async () => {
    const { env, configPath } = sandboxEnv()

    writeFileSync(
      configPath,
      `${NO_SIDEBAR}\n[[keys.command]]\nkey = "prefix+/"\n`
        + "type = \"shell\"\ncommand = \"my-command\"\n",
    )

    const before = readFileSync(configPath, "utf8")
    const result = await run(["pane-move-keybind-install"], env)

    expect(result.code).toBe(0)
    expect(readFileSync(configPath, "utf8")).toBe(before)
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).pane_move_keybind_installed)
      .toBe(false)
  })

  test("picker keybind install writes the marker and is removable", async () => {
    const { env, configPath } = sandboxEnv()
    const installed = await run(["keybind-install"], env)

    expect(installed.code).toBe(0)
    expect(installed.stdout).toContain("bound prefix+i to the identity picker")
    expect(readFileSync(configPath, "utf8")).toContain("# added by iurysza.mosaic")
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).keybind_installed).toBe(true)

    const removed = await run(["keybind-remove"], env)

    expect(removed.code).toBe(0)
    expect(readFileSync(configPath, "utf8")).not.toContain("iurysza.mosaic.set-identity")
    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).keybind_installed).toBe(false)
  })

  test("owned prefix+. idle binding retargets to ctrl+. when that chord is free", async () => {
    const { env, configPath } = sandboxEnv()
    const statePath = join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")
    const state = defaultState()

    state.idle_keybind_installed = true
    state.idle_keybind_key = OWNED_IDLE_KEYBIND
    save(statePath, state)
    writeFileSync(
      configPath,
      `${NO_SIDEBAR}\n[[keys.command]]\nkey = "${OWNED_IDLE_KEYBIND}"\n`
        + "type = \"plugin_action\"\n"
        + `command = "${IDLE_NEXT_COMMAND}"\n`,
    )

    const result = await run(["idle-keybind-install"], env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`retargeted idle agent shortcut from ${OWNED_IDLE_KEYBIND}`)
    expect(keybindKey(TomlDoc.load(configPath), IDLE_NEXT_COMMAND)).toBe(DEFAULT_IDLE_KEYBIND)
    expect(load(statePath).idle_keybind_key).toBe(DEFAULT_IDLE_KEYBIND)
  })

  test("a customized idle binding is left unchanged", async () => {
    const { env, configPath } = sandboxEnv()
    const statePath = join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")
    const state = defaultState()

    state.idle_keybind_installed = true
    state.idle_keybind_key = "prefix+shift+."
    save(statePath, state)
    writeFileSync(
      configPath,
      `${NO_SIDEBAR}\n[[keys.command]]\nkey = "prefix+shift+."\n`
        + "type = \"plugin_action\"\n"
        + `command = "${IDLE_NEXT_COMMAND}"\n`,
    )

    const before = readFileSync(configPath, "utf8")
    const result = await run(["idle-keybind-install"], env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("leaving your choice alone")
    expect(readFileSync(configPath, "utf8")).toBe(before)
    expect(load(statePath).idle_keybind_key).toBe("prefix+shift+.")
  })

  test("occupied ctrl+. keeps the owned prefix+. binding", async () => {
    const { env, configPath } = sandboxEnv()
    const statePath = join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")
    const state = defaultState()

    state.idle_keybind_installed = true
    state.idle_keybind_key = OWNED_IDLE_KEYBIND
    save(statePath, state)
    writeFileSync(
      configPath,
      `${NO_SIDEBAR}\n[keys]\nprevious_tab = "ctrl+."\n\n[[keys.command]]\n`
        + `key = "${OWNED_IDLE_KEYBIND}"\n`
        + "type = \"plugin_action\"\n"
        + `command = "${IDLE_NEXT_COMMAND}"\n`,
    )

    const result = await run(["idle-keybind-install"], env)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("leaving prefix+.")
    expect(keybindKey(TomlDoc.load(configPath), IDLE_NEXT_COMMAND)).toBe(OWNED_IDLE_KEYBIND)
    expect(load(statePath).idle_keybind_installed).toBe(true)
  })

  test("oldest shortcut installs only when ctrl+, is free", async () => {
    const { env, configPath } = sandboxEnv()
    const statePath = join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")

    expect((await run(["oldest-idle-keybind-install"], env)).code).toBe(0)
    expect(keybindKey(TomlDoc.load(configPath), IDLE_OLDEST_COMMAND)).toBe(DEFAULT_OLDEST_IDLE_KEYBIND)
    expect(load(statePath).oldest_idle_keybind_installed).toBe(true)

    const occupied = sandboxEnv()

    writeFileSync(
      occupied.configPath,
      `${NO_SIDEBAR}\n[[keys.command]]\nkey = "ctrl+,"\ntype = "shell"\ncommand = "my-command"\n`,
    )

    const blocked = await run(["oldest-idle-keybind-install"], occupied.env)

    expect(blocked.code).toBe(0)
    expect(blocked.stdout).toContain("already bound")
    expect(keybindKey(TomlDoc.load(occupied.configPath), IDLE_OLDEST_COMMAND)).toBeUndefined()
    expect(load(join(occupied.env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json"))
      .oldest_idle_keybind_installed).toBe(false)
  })

  test("navigation chords bind free Herdr actions and uninstall deletes only those keys", async () => {
    const { env, configPath } = sandboxEnv()
    const statePath = join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")
    const fake = new FakeHerdr(env.HERDR_SOCKET_PATH ?? "")

    fake.on("workspace.list", () => ({ workspaces: [] }))
    fake.on("agent.list", () => ({ agents: [] }))
    fake.on("server.reload_config", () => ({ status: "applied", diagnostics: [] }))
    fake.on("pane.report_metadata", () => ({}))
    fake.on("client.window_title.clear", () => ({}))
    writeFileSync(
      configPath,
      `${NO_SIDEBAR}\n[keys]\nprevious_tab = "prefix+p"\n\n[[keys.command]]\n`
        + "key = \"ctrl+]\"\ntype = \"shell\"\ncommand = \"my-command\"\n",
    )

    await fake.listen()

    try {
      const installed = await run(["navigation-keybind-install"], env)
      const doc = TomlDoc.load(configPath)

      expect(installed.code).toBe(0)
      expect(installed.stdout).toContain("previous_tab already set")
      expect(installed.stdout).toContain("not binding next_tab")
      expect(nativeKeyValue(doc, "previous_tab")).toBe("prefix+p")
      expect(nativeKeyValue(doc, "next_tab")).toBeUndefined()
      expect(nativeKeyValue(doc, "previous_agent")).toBe("ctrl+shift+[")
      expect(nativeKeyValue(doc, "next_agent")).toBe("ctrl+shift+]")
      expect(load(statePath).nav_keybinds).toEqual({
        previous_agent: "ctrl+shift+[",
        next_agent: "ctrl+shift+]",
      })

      const removed = await run(["uninstall"], env)
      const after = TomlDoc.load(configPath)

      expect(removed.code).toBe(0)
      expect(nativeKeyValue(after, "previous_tab")).toBe("prefix+p")
      expect(nativeKeyValue(after, "previous_agent")).toBeUndefined()
      expect(nativeKeyValue(after, "next_agent")).toBeUndefined()
      expect(keybindKey(after, "my-command")).toBe("ctrl+]")
      expect(load(statePath).nav_keybinds).toEqual({})
    } finally {
      await fake.close()
    }
  })

  test("a fresh navigation install binds the four sidebar and tab actions", async () => {
    const { env, configPath } = sandboxEnv()
    const installed = await run(["navigation-keybind-install"], env)
    const doc = TomlDoc.load(configPath)

    expect(installed.code).toBe(0)

    for (const binding of NATIVE_NAV_BINDINGS) {
      expect(nativeKeyValue(doc, binding.action)).toBe(binding.chord)
    }

    expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).nav_keybinds).toEqual({
      previous_tab: "ctrl+[",
      next_tab: "ctrl+]",
      previous_agent: "ctrl+shift+[",
      next_agent: "ctrl+shift+]",
    })
  })
})
