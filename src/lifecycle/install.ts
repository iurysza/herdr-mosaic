import { join } from "node:path"

import { Effect, Result } from "effect"

import { runView } from "../agents/view.ts"
import { actionRenamesOf, findRename, sameRename, storeActionRenames } from "../config/action-renames.ts"
import {
  runIdleKeybindInstall,
  runKeybindInstall,
  runNavigationKeybindInstall,
  runOldestIdleKeybindInstall,
  runPaneMoveKeybindInstall,
  runPromotePaneKeybindInstall,
  runPruneKeybindInstall,
  runSortKeybindInstall,
} from "../config/keybinds.ts"
import {
  commitDoc,
  loadDoc,
  renamePluginActions,
  snapshotConfig,
} from "../config/patch.ts"
import { reloadConfig } from "../config/reload.ts"
import { runSidebarInstall } from "../config/sidebar.ts"
import { PLUGIN_ID, WINDOW_MANAGER_ID } from "../ids.ts"
import { runMigrate } from "../migrate/run.ts"
import { ConfigError } from "../runtime/errors.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  appendCommand,
  emptyOutput,
  joinOutput,
  pluginWarn,
  type CapturedOutput,
  type CommandResult,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { load, save } from "../state/store.ts"
import { runReconcile } from "./reconcile.ts"

function statePath(stateDir: string): string {
  return join(stateDir, "state.json")
}

function commandResult(code: number, output: CapturedOutput): CommandResult {
  return {
    code,
    stdout: joinOutput(output.stdout),
    stderr: joinOutput(output.stderr),
  }
}

export const runInstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  if (argv.includes("--dry-run")) {
    const migrated = yield* runMigrate(argv)

    return appendCommand(
      {
        code: 0,
        stdout: "install --dry-run only previews migrate; sidebar, keybind, and view are not written\n",
        stderr: "",
      },
      migrated,
    )
  }

  let acc: CommandResult = { code: 0, stdout: "", stderr: "" }
  const migrate = yield* runMigrate(argv)

  acc = appendCommand(acc, migrate)

  if (acc.code !== 0) return acc

  const ordered = [
    runSidebarInstall,
    runKeybindInstall,
    runSortKeybindInstall,
    runIdleKeybindInstall,
    runOldestIdleKeybindInstall,
    runPruneKeybindInstall,
    runPaneMoveKeybindInstall,
    runPromotePaneKeybindInstall,
    runNavigationKeybindInstall,
  ] as const

  for (const step of ordered) {
    acc = appendCommand(acc, yield* step(argv))

    if (acc.code !== 0) return acc
  }

  const paths = yield* PluginPaths
  const output = emptyOutput()

  const renamed = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    renameLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "install: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  acc = appendCommand(acc, commandResult(renamed, output))

  if (acc.code !== 0) return acc

  const state = load(statePath(paths.stateDir))
  let mode = state.view_mode || "all"

  if (mode !== "all" && mode !== "current") mode = "all"

  acc = appendCommand(acc, yield* runView([mode]))

  if (acc.code !== 0) return acc

  return appendCommand(acc, yield* runReconcile(argv))
})

const renameLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const state = load(statePath(paths.stateDir))
  const doc = loadDoc(paths.herdrConfigPath)

  const renamed = (() => {
    try {
      return { ok: true as const, records: renamePluginActions(doc, WINDOW_MANAGER_ID, PLUGIN_ID) }
    } catch (error) {
      return { ok: false as const, error }
    }
  })()

  if (!renamed.ok) {
    if (renamed.error instanceof ConfigError) {
      yield* pluginWarn(paths, output, renamed.error.message)

      return 1
    }

    throw renamed.error
  }

  const records = renamed.records

  if (records.length === 0) return 0

  yield* snapshotConfig(paths.herdrConfigPath, paths.stateDir)

  const saved = actionRenamesOf(state)

  for (const record of records) {
    const previous = findRename(saved, record)

    if (previous === undefined) {
      saved.push(record)
    } else if (!sameRename(previous, record)) {
      yield* pluginWarn(
        paths,
        output,
        `binding ${record.key ?? "None"} changed since migration; not overwriting`,
      )

      return 1
    }
  }

  storeActionRenames(state, saved)
  save(statePath(paths.stateDir), state)

  const committed = yield* commitDoc(doc, paths.herdrConfigPath).pipe(Effect.result)

  if (Result.isFailure(committed)) {
    yield* pluginWarn(paths, output, committed.failure.message)

    return 1
  }

  yield* reloadConfig(paths, output)

  return 0
})
