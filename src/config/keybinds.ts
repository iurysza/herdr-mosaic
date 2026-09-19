import { join } from "node:path"

import { Effect, Result } from "effect"

import { flagString, parseKv } from "../dispatch/flags.ts"
import { PLUGIN_ID } from "../ids.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginLog,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { load, save, type PluginState } from "../state/store.ts"
import {
  commitDoc,
  installKeybind,
  loadDoc,
  removeKeybind,
  snapshotConfig,
} from "./patch.ts"
import { reloadConfig } from "./reload.ts"

export const DEFAULT_KEYBIND = "prefix+i"

export const DEFAULT_SORT_KEYBIND = "prefix+shift+s"

export const DEFAULT_IDLE_KEYBIND = "prefix+."

export const DEFAULT_PRUNE_KEYBIND = "prefix+alt+x"

export const DEFAULT_PANE_MOVE_KEYBIND = "prefix+/"

export const DEFAULT_PROMOTE_PANE_KEYBIND = "prefix+shift+m"

export const PICKER_COMMAND = `${PLUGIN_ID}.set-identity`

export const SORT_TOGGLE_COMMAND = `${PLUGIN_ID}.toggle-agent-sort`

export const IDLE_NEXT_COMMAND = `${PLUGIN_ID}.next-idle-agent`

export const PRUNE_COMMAND = `${PLUGIN_ID}.prune-stale-agents`

export const PANE_MOVE_COMMAND = `${PLUGIN_ID}.move-pane`

export const PROMOTE_PANE_COMMAND = `${PLUGIN_ID}.promote-pane`

type InstalledField =
  | "keybind_installed"
  | "sort_keybind_installed"
  | "idle_keybind_installed"
  | "prune_keybind_installed"
  | "pane_move_keybind_installed"
  | "promote_pane_keybind_installed"

type KeyField =
  | "keybind_key"
  | "sort_keybind_key"
  | "idle_keybind_key"
  | "prune_keybind_key"
  | "pane_move_keybind_key"
  | "promote_pane_keybind_key"

type ManagedSpec = {
  readonly command: string
  readonly defaultKey: string
  readonly installedField: InstalledField
  readonly keyField: KeyField
  readonly description: string
  readonly label: string
}

function statePath(stateDir: string): string {
  return join(stateDir, "state.json")
}

function commandResult(code: number, output: CapturedOutput) {
  return {
    code,
    stdout: joinOutput(output.stdout),
    stderr: joinOutput(output.stderr),
  } as const
}

function boundText(bound: string | undefined): string {
  return bound ?? "None"
}

function requestedKey(argv: readonly string[], fallback: string): string {
  return flagString(parseKv(argv), "key") ?? fallback
}

function setClaim(state: PluginState, installed: InstalledField, keyField: KeyField, key: string): void {
  state[installed] = true
  state[keyField] = key
}

function clearClaim(state: PluginState, installed: InstalledField, keyField: KeyField): void {
  state[installed] = false
  state[keyField] = null
}

const commitOrWarn = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  doc: ReturnType<typeof loadDoc>,
) {
  const committed = yield* commitDoc(doc, paths.herdrConfigPath).pipe(Effect.result)

  if (Result.isFailure(committed)) {
    yield* pluginWarn(paths, output, committed.failure.message)

    return false
  }

  return true
})

export const runKeybindInstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const key = requestedKey(argv, DEFAULT_KEYBIND)

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    pickerInstallLocked(paths, output, key),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "keybind-install: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const pickerInstallLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  key: string,
) {
  const st = load(statePath(paths.stateDir))
  const doc = loadDoc(paths.herdrConfigPath)

  yield* snapshotConfig(paths.herdrConfigPath, paths.stateDir)

  const result = installKeybind(doc, key, PICKER_COMMAND, "Mosaic: set Space colour")

  if (result.status === "exists") {
    output.stdout.push(
      `already bound to ${boundText(result.bound)} (leaving your choice alone); `
        + "edit config.toml to change it",
    )
    st.keybind_installed = true
    st.keybind_key = result.bound === undefined ? null : result.bound
    save(statePath(paths.stateDir), st)

    return 0
  }

  if (result.status === "occupied") {
    output.stdout.push(
      `key ${key} is already bound to ${boundText(result.bound)}; not adding a second binding. `
        + "Use keybind-install --key <other>.",
    )
    save(statePath(paths.stateDir), st)

    return 0
  }

  if (!(yield* commitOrWarn(paths, output, doc))) return 1

  setClaim(st, "keybind_installed", "keybind_key", key)
  save(statePath(paths.stateDir), st)
  yield* reloadConfig(paths, output)
  yield* pluginLog(paths, output, `keybinding installed: ${key} -> ${PICKER_COMMAND}`)

  const prefixHint = key.startsWith("prefix+")
    ? "  (prefix is ctrl+b unless you changed keys.prefix)"
    : ""

  output.stdout.push(`bound ${key} to the identity picker${prefixHint}`)

  return 0
})

export const runKeybindRemove = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    pickerRemoveLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "keybind-remove: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const pickerRemoveLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const st = load(statePath(paths.stateDir))
  const doc = loadDoc(paths.herdrConfigPath)

  if (!removeKeybind(doc, PICKER_COMMAND)) {
    output.stdout.push("no plugin keybinding found")
    st.keybind_installed = false
    save(statePath(paths.stateDir), st)

    return 0
  }

  if (!(yield* commitOrWarn(paths, output, doc))) return 1

  st.keybind_installed = false
  st.keybind_key = null
  save(statePath(paths.stateDir), st)
  yield* reloadConfig(paths, output)
  yield* pluginLog(paths, output, "keybinding removed")
  output.stdout.push("keybinding removed")

  return 0
})

export const runSortKeybindInstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const key = requestedKey(argv, DEFAULT_SORT_KEYBIND)

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    sortInstallLocked(paths, output, key),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "sort-keybind-install: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const sortInstallLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  key: string,
) {
  const st = load(statePath(paths.stateDir))
  const doc = loadDoc(paths.herdrConfigPath)

  yield* snapshotConfig(paths.herdrConfigPath, paths.stateDir)

  const result = installKeybind(doc, key, SORT_TOGGLE_COMMAND, "Mosaic: toggle agent sort")

  if (result.status === "exists") {
    if (st.sort_keybind_installed) {
      st.sort_keybind_key = result.bound ?? key
      save(statePath(paths.stateDir), st)
    }

    output.stdout.push(`already bound to ${boundText(result.bound)} (leaving your choice alone)`)

    return 0
  }

  if (result.status === "occupied") {
    output.stdout.push(
      `key ${key} is already bound to ${boundText(result.bound)}; not adding a second binding. `
        + "Use sort-keybind-install --key <other>.",
    )
    save(statePath(paths.stateDir), st)

    return 0
  }

  if (!(yield* commitOrWarn(paths, output, doc))) return 1

  setClaim(st, "sort_keybind_installed", "sort_keybind_key", key)
  save(statePath(paths.stateDir), st)
  yield* reloadConfig(paths, output)
  yield* pluginLog(paths, output, `keybinding installed: ${key} -> ${SORT_TOGGLE_COMMAND}`)
  output.stdout.push(`bound ${key} to Toggle Agent Sort`)

  return 0
})

export const runSortKeybindRemove = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    sortRemoveLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "sort-keybind-remove: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const sortRemoveLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const st = load(statePath(paths.stateDir))
  const doc = loadDoc(paths.herdrConfigPath)

  if (!removeKeybind(doc, SORT_TOGGLE_COMMAND)) {
    output.stdout.push("no sort keybinding found")
    clearClaim(st, "sort_keybind_installed", "sort_keybind_key")
    save(statePath(paths.stateDir), st)

    return 0
  }

  if (!(yield* commitOrWarn(paths, output, doc))) return 1

  clearClaim(st, "sort_keybind_installed", "sort_keybind_key")
  save(statePath(paths.stateDir), st)
  yield* reloadConfig(paths, output)
  yield* pluginLog(paths, output, "sort keybinding removed")
  output.stdout.push("sort keybinding removed")

  return 0
})

const managedInstallLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  spec: ManagedSpec,
  key: string,
) {
  const st = load(statePath(paths.stateDir))
  const doc = loadDoc(paths.herdrConfigPath)

  yield* snapshotConfig(paths.herdrConfigPath, paths.stateDir)

  const result = installKeybind(doc, key, spec.command, spec.description)

  if (result.status === "exists") {
    output.stdout.push(`already bound to ${boundText(result.bound)} (leaving your choice alone)`)

    return 0
  }

  if (result.status === "occupied") {
    output.stdout.push(
      `key ${key} is already bound to ${boundText(result.bound)}; not adding a second binding. `
        + "Use the direct keybind installer with --key <other>.",
    )

    return 0
  }

  if (!(yield* commitOrWarn(paths, output, doc))) return 1

  setClaim(st, spec.installedField, spec.keyField, key)
  save(statePath(paths.stateDir), st)
  yield* reloadConfig(paths, output)
  yield* pluginLog(paths, output, `keybinding installed: ${key} -> ${spec.command}`)
  output.stdout.push(`bound ${key} to ${spec.label}`)

  return 0
})

const managedRemoveLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  spec: ManagedSpec,
) {
  const st = load(statePath(paths.stateDir))

  if (!st[spec.installedField]) {
    output.stdout.push(`no Mosaic-managed ${spec.label} keybinding found`)

    return 0
  }

  const doc = loadDoc(paths.herdrConfigPath)

  if (!removeKeybind(doc, spec.command)) {
    clearClaim(st, spec.installedField, spec.keyField)
    save(statePath(paths.stateDir), st)
    output.stdout.push(`no ${spec.label} keybinding found`)

    return 0
  }

  if (!(yield* commitOrWarn(paths, output, doc))) return 1

  clearClaim(st, spec.installedField, spec.keyField)
  save(statePath(paths.stateDir), st)
  yield* reloadConfig(paths, output)
  yield* pluginLog(paths, output, `keybinding removed: ${spec.command}`)
  output.stdout.push(`${spec.label} keybinding removed`)

  return 0
})

const runManagedInstall = Effect.fnUntraced(function*(
  argv: readonly string[],
  spec: ManagedSpec,
) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const key = requestedKey(argv, spec.defaultKey)

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    managedInstallLocked(paths, output, spec, key),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "keybind-install: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const runManagedRemove = Effect.fnUntraced(function*(
  argv: readonly string[],
  spec: ManagedSpec,
) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    managedRemoveLocked(paths, output, spec),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "keybind-remove: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const IDLE_SPEC: ManagedSpec = {
  command: IDLE_NEXT_COMMAND,
  defaultKey: DEFAULT_IDLE_KEYBIND,
  installedField: "idle_keybind_installed",
  keyField: "idle_keybind_key",
  description: "Mosaic: next idle agent",
  label: "Next idle agent",
}

const PRUNE_SPEC: ManagedSpec = {
  command: PRUNE_COMMAND,
  defaultKey: DEFAULT_PRUNE_KEYBIND,
  installedField: "prune_keybind_installed",
  keyField: "prune_keybind_key",
  description: "Mosaic: prune stale agents",
  label: "Prune stale agents",
}

const PANE_MOVE_SPEC: ManagedSpec = {
  command: PANE_MOVE_COMMAND,
  defaultKey: DEFAULT_PANE_MOVE_KEYBIND,
  installedField: "pane_move_keybind_installed",
  keyField: "pane_move_keybind_key",
  description: "Mosaic: move pane",
  label: "Move pane",
}

const PROMOTE_SPEC: ManagedSpec = {
  command: PROMOTE_PANE_COMMAND,
  defaultKey: DEFAULT_PROMOTE_PANE_KEYBIND,
  installedField: "promote_pane_keybind_installed",
  keyField: "promote_pane_keybind_key",
  description: "Mosaic: promote pane to new tab",
  label: "Promote pane",
}

export const runIdleKeybindInstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runManagedInstall(argv, IDLE_SPEC)
})

export const runIdleKeybindRemove = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runManagedRemove(argv, IDLE_SPEC)
})

export const runPruneKeybindInstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runManagedInstall(argv, PRUNE_SPEC)
})

export const runPruneKeybindRemove = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runManagedRemove(argv, PRUNE_SPEC)
})

export const runPaneMoveKeybindInstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runManagedInstall(argv, PANE_MOVE_SPEC)
})

export const runPaneMoveKeybindRemove = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runManagedRemove(argv, PANE_MOVE_SPEC)
})

export const runPromotePaneKeybindInstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runManagedInstall(argv, PROMOTE_SPEC)
})

export const runPromotePaneKeybindRemove = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runManagedRemove(argv, PROMOTE_SPEC)
})
