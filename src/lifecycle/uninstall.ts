import { join } from "node:path"

import { Effect, Result, Schema } from "effect"

import { clearView } from "../agents/view.ts"
import { actionRenamesOf, storeActionRenames } from "../config/action-renames.ts"
import {
  IDLE_NEXT_COMMAND,
  IDLE_OLDEST_COMMAND,
  PANE_MOVE_COMMAND,
  PICKER_COMMAND,
  PROMOTE_PANE_COMMAND,
  PRUNE_COMMAND,
  removeRecordedNavigationKeys,
  SORT_TOGGLE_COMMAND,
} from "../config/keybinds.ts"
import {
  detectConflicts,
  loadDoc,
  removeKeybind,
  restoreActionRenames,
  restoreBackup,
  SIDEBAR_TIDY_TABLES,
  commitDoc,
  snapshotConfig,
  type ActionRenameRecord,
} from "../config/patch.ts"
import { backupFromJson, lastWrittenPairs } from "../config/sidebar.ts"
import { reloadConfig } from "../config/reload.ts"
import { ELAPSED_SOURCE, PLUGIN_ID, TITLE_SOURCE } from "../ids.ts"
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
import {
  listAgents,
  listWorkspaces,
  rpcTryCall,
  type JsonObject,
} from "../runtime/rpc.ts"
import { load, save, type PluginState } from "../state/store.ts"
import { PALETTE } from "../spaces/palette.ts"
import { agentFromRpc, clearPane, clearWorkspace, workspaceFromRpc } from "../spaces/metadata.ts"

type Json = typeof Schema.Json.Type

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

type ThemeRestoreResult = {
  readonly restored: ReadonlyArray<readonly [string, string]>
  readonly skipped: readonly string[]
}

function jsonObject(value: Json): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isSuccess(decoded)) return decoded.success

  return {}
}

function migratedPicker(records: readonly ActionRenameRecord[]): boolean {
  for (const record of records) {
    if (record.command === PICKER_COMMAND) return true
  }

  return false
}

const restoreTheme = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
  doc: ReturnType<typeof loadDoc>,
  force: boolean,
) {
  const backup = backupFromJson(state.theme_backup)

  if (backup === undefined) {
    const empty: ThemeRestoreResult = { restored: [], skipped: [] }

    return empty
  }

  const managed = new Set(Object.keys(backup.keys))
  const conflicts = detectConflicts(doc, lastWrittenPairs(state.last_written), managed)
  const skip = new Set<string>()

  if (conflicts.length > 0 && !force) {
    for (const conflict of conflicts) {
      const found = conflict.actual === undefined ? "None" : JSON.stringify(conflict.actual)

      yield* pluginWarn(
        paths,
        output,
        `${conflict.key} changed outside the plugin (plugin wrote ${JSON.stringify(conflict.expected)}, found ${found}); `
          + "leaving it alone -- use --force to restore anyway",
      )
      skip.add(conflict.key)
    }
  }

  const restored = restoreBackup(doc, backup, [["theme", "custom"]], skip)
  const skipped: string[] = []

  for (const key of skip) skipped.push(key)

  skipped.sort()

  return { restored, skipped }
})

const clearWindowTitle = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
) {
  if (!state.window_title_set) return

  const outcome = yield* rpcTryCall("client.window_title.clear", {})

  if (outcome.error !== undefined) {
    yield* pluginWarn(
      paths,
      output,
      `window title clear failed: ${outcome.error.code}: ${outcome.error.message}`,
    )
  }

  state.window_title_set = false
})

const clearSidebarSources = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  agents: readonly ReturnType<typeof agentFromRpc>[],
) {
  for (const agent of agents) {
    const paneId = agent.pane_id

    if (paneId === undefined || paneId === "") continue

    const titleTokens: { [key: string]: Json } = {}

    for (const [name] of PALETTE) {
      titleTokens[`title_${name}`] = null
    }

    const sources: Array<readonly [string, JsonObject]> = [
      [TITLE_SOURCE, jsonObject(titleTokens)],
      [ELAPSED_SOURCE, jsonObject({ elapsed: null })],
    ]

    for (const [source, tokens] of sources) {
      const outcome = yield* rpcTryCall("pane.report_metadata", jsonObject({
        pane_id: paneId,
        source,
        tokens,
      }))

      if (outcome.error !== undefined) {
        yield* pluginWarn(
          paths,
          output,
          `sidebar clear failed for ${paneId}: ${outcome.error.code}: ${outcome.error.message}`,
        )
      }
    }
  }
})

export const runUninstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const force = argv.includes("--force")

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    uninstallLocked(paths, output, force),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "uninstall: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const uninstallLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  force: boolean,
) {
  const state = load(statePath(paths.stateDir))

  yield* snapshotConfig(paths.herdrConfigPath, paths.stateDir)

  const doc = loadDoc(paths.herdrConfigPath)
  const notes: string[] = []
  const actionRenames = actionRenamesOf(state)
  const skipPicker = migratedPicker(actionRenames)
  const remaining = restoreActionRenames(doc, actionRenames)

  if (remaining.length > 0) {
    const keys: string[] = []

    for (const record of remaining) keys.push(String(record.key ?? "None"))

    notes.push(`action bindings skipped (user-modified): ${keys.join(", ")}`)
  }

  const theme = yield* restoreTheme(paths, output, state, doc, force)

  if (theme.restored.length > 0) notes.push(`theme: ${theme.restored.length} keys`)

  if (theme.skipped.length > 0) {
    notes.push(`theme skipped (user-modified): ${theme.skipped.join(", ")}`)
  }

  const sidebarBackup = backupFromJson(state.sidebar_backup)

  if (sidebarBackup !== undefined) {
    const managed = new Set(Object.keys(sidebarBackup.keys))
    const conflicts = detectConflicts(doc, lastWrittenPairs(state.last_written), managed)
    const skip = new Set<string>()

    if (conflicts.length > 0 && !force) {
      for (const conflict of conflicts) {
        const found = conflict.actual === undefined ? "None" : JSON.stringify(conflict.actual)

        yield* pluginWarn(
          paths,
          output,
          `${conflict.key} changed outside the plugin; leaving it alone `
            + `(--force to restore). plugin wrote ${JSON.stringify(conflict.expected)}, found ${found}`,
        )
        skip.add(conflict.key)
      }
    }

    const restored = restoreBackup(doc, sidebarBackup, SIDEBAR_TIDY_TABLES, skip)

    notes.push(`sidebar: ${restored.length} row sets`)
  }

  if (!skipPicker && removeKeybind(doc, PICKER_COMMAND)) notes.push("picker keybinding removed")

  if (state.sort_keybind_installed && removeKeybind(doc, SORT_TOGGLE_COMMAND)) {
    notes.push("sort keybinding removed")
  }

  if (state.idle_keybind_installed && removeKeybind(doc, IDLE_NEXT_COMMAND)) {
    notes.push("idle-agent keybinding removed")
  }

  if (state.oldest_idle_keybind_installed && removeKeybind(doc, IDLE_OLDEST_COMMAND)) {
    notes.push("oldest-agent keybinding removed")
  }

  if (state.prune_keybind_installed && removeKeybind(doc, PRUNE_COMMAND)) {
    notes.push("prune keybinding removed")
  }

  if (state.pane_move_keybind_installed && removeKeybind(doc, PANE_MOVE_COMMAND)) {
    notes.push("pane move keybinding removed")
  }

  if (state.promote_pane_keybind_installed && removeKeybind(doc, PROMOTE_PANE_COMMAND)) {
    notes.push("promote pane keybinding removed")
  }

  if (removeRecordedNavigationKeys(doc, state).length > 0) {
    notes.push("navigation keybindings removed")
  }

  state.keybind_installed = false
  state.keybind_key = null
  state.sort_keybind_installed = false
  state.sort_keybind_key = null
  state.idle_keybind_installed = false
  state.idle_keybind_key = null
  state.oldest_idle_keybind_installed = false
  state.oldest_idle_keybind_key = null
  state.nav_keybinds = {}
  state.prune_keybind_installed = false
  state.prune_keybind_key = null
  state.pane_move_keybind_installed = false
  state.pane_move_keybind_key = null
  state.promote_pane_keybind_installed = false
  state.promote_pane_keybind_key = null
  state.idle_cycle_last_pane_id = null
  state.idle_navigation_heads = {}
  state.pending_pane_move = null

  const committed = yield* commitDoc(doc, paths.herdrConfigPath).pipe(Effect.result)

  if (Result.isFailure(committed)) {
    yield* pluginWarn(paths, output, `config restore failed, nothing written: ${committed.failure.message}`)

    return 1
  }

  if (state.view_installed) {
    const cleared = yield* clearView()

    if (cleared.error !== undefined) {
      yield* pluginWarn(paths, output, `agent view clear failed: ${cleared.error}`)
    } else {
      notes.push("agent view cleared")
    }

    state.view_installed = false
  }

  const workspaces = (yield* listWorkspaces()).map(workspaceFromRpc)
  const agents = (yield* listAgents()).map(agentFromRpc)

  for (const workspace of workspaces) {
    const wid = workspace.workspace_id

    if (wid === undefined || wid === "") continue

    yield* clearWorkspace(wid)
  }

  for (const agent of agents) {
    const paneId = agent.pane_id

    if (paneId === undefined || paneId === "") continue

    yield* clearPane(paneId)
  }

  yield* clearSidebarSources(paths, output, agents)
  notes.push("metadata cleared")

  yield* clearWindowTitle(paths, output, state)
  yield* reloadConfig(paths, output)

  state.theme_backup = null
  state.sidebar_backup = null
  state.ownership_baseline = null
  state.sidebar_installed = false
  state.tint_enabled = false
  state.last_tint = null
  state.last_written = {}
  storeActionRenames(state, remaining)
  save(statePath(paths.stateDir), state)
  yield* pluginLog(paths, output, `uninstall complete: ${notes.join("; ")}`)
  output.stdout.push(`restored. ${notes.join("; ")}`)
  output.stdout.push("")
  output.stdout.push(`Identities are kept in ${paths.stateDir} so relinking restores them.`)
  output.stdout.push(`Now run:  herdr plugin unlink ${PLUGIN_ID}`)

  return 0
})
