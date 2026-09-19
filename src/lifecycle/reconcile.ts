import { join } from "node:path"

import { Effect, Predicate } from "effect"

import { installView, normalizeScope, normalizeSort } from "../agents/view.ts"
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
import { focusedWorkspace, listAgents, listWorkspaces } from "../runtime/rpc.ts"
import { loadSettings } from "../runtime/settings.ts"
import { load, save } from "../state/store.ts"
import { agentFromRpc, reconcileMetadata, workspaceFromRpc } from "../spaces/metadata.ts"
import { applyTint, setWindowTitle } from "../spaces/tint.ts"

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

export const runReconcile = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    reconcileLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "reconcile: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const reconcileLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const state = load(statePath(paths.stateDir))
  const workspaces = (yield* listWorkspaces()).map(workspaceFromRpc)
  const agents = (yield* listAgents()).map(agentFromRpc)

  yield* reconcileMetadata(paths, output, state, workspaces, agents)

  if (state.view_installed) {
    const mode = normalizeScope(state.view_mode)
    const sort = normalizeSort(state.sort_mode)
    const installed = yield* installView(mode, sort)

    if (installed.error !== undefined) {
      yield* pluginWarn(paths, output, `agent view reinstall failed: ${installed.error}`)
    } else {
      yield* pluginLog(paths, output, `agent view reapplied (${mode}, ${sort})`)
    }
  }

  if (state.tint_enabled) {
    const focused = yield* focusedWorkspace()
    const workspaceId = Predicate.isString(focused?.workspace_id) ? focused.workspace_id : undefined

    if (workspaceId !== undefined && workspaceId !== "") {
      const result = yield* applyTint(paths, output, state, workspaceId, false, workspaces)

      if (result.status === "applied") {
        const label = Predicate.isString(focused?.label) && focused.label !== ""
          ? focused.label
          : workspaceId

        yield* setWindowTitle(paths, output, state, label, loadSettings(paths))
      }
    }
  }

  save(statePath(paths.stateDir), state)

  return 0
})
