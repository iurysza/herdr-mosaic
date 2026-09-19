import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import {
  DEFAULT_IDLE_KEYBIND,
  DEFAULT_PANE_MOVE_KEYBIND,
  DEFAULT_PRUNE_KEYBIND,
  DEFAULT_PROMOTE_PANE_KEYBIND,
  DEFAULT_SORT_KEYBIND,
  IDLE_NEXT_COMMAND,
  PANE_MOVE_COMMAND,
  PRUNE_COMMAND,
  PROMOTE_PANE_COMMAND,
  SORT_TOGGLE_COMMAND,
} from "../../src/config/keybinds.ts"
import { keybindKey } from "../../src/config/patch.ts"
import { TomlDoc } from "../../src/config/toml-edit.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { load } from "../../src/state/store.ts"
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
})
