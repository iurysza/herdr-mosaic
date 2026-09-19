import { join } from "node:path"

import { Effect, Predicate, Result, Schema } from "effect"

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
import { rpcTryCall, type JsonObject } from "../runtime/rpc.ts"
import { load, save, type PluginState, type SortMode, type ViewMode } from "../state/store.ts"

type Json = typeof Schema.Json.Type

export const SCOPES = ["all", "current"] as const

export const SORTS = ["activity", "spaces"] as const

export const LABELS = [
  ["activity", "Activity"],
  ["spaces", "Spaces"],
] as const

export type SortClause = {
  readonly field: string
  readonly order: string
}

export const SORT_ACTIVITY: readonly SortClause[] = [
  { field: "attention", order: "desc" },
  { field: "state_change_seq", order: "desc" },
  { field: "workspace_order", order: "asc" },
  { field: "tab_order", order: "asc" },
  { field: "pane_order", order: "asc" },
]

export const SORT_SPACES: readonly SortClause[] = [
  { field: "workspace_order", order: "asc" },
  { field: "attention", order: "desc" },
  { field: "tab_order", order: "asc" },
  { field: "pane_order", order: "asc" },
]

export type AgentViewDefinition = {
  readonly source: string
  readonly label: string
  readonly sort: readonly SortClause[]
  readonly filter?: JsonObject
}

export type ViewInstallOutcome = {
  readonly result?: JsonObject
  readonly error?: string
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

function sortLabel(sort: SortMode): string {
  for (const [name, label] of LABELS) {
    if (name === sort) return label
  }

  return "Spaces"
}

export function normalizeScope(mode: Json | undefined): ViewMode {
  return mode === "current" ? "current" : "all"
}

export function normalizeSort(sort: Json | undefined): SortMode {
  return sort === "activity" ? "activity" : "spaces"
}

function jsonObject(value: Json): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isSuccess(decoded)) return decoded.success

  return {}
}

export function definition(mode: string = "all", sort: string = "spaces"): AgentViewDefinition {
  const scope = normalizeScope(mode)
  const axis = normalizeSort(sort)
  const clauses = axis === "activity" ? SORT_ACTIVITY : SORT_SPACES
  const copied: SortClause[] = []

  for (const clause of clauses) {
    copied.push({ field: clause.field, order: clause.order })
  }

  if (scope === "current") {
    return {
      source: PLUGIN_ID,
      label: sortLabel(axis),
      sort: copied,
      filter: jsonObject({
        op: "eq",
        field: "workspace_id",
        value: { context: "current_workspace_id" },
      }),
    }
  }

  return {
    source: PLUGIN_ID,
    label: sortLabel(axis),
    sort: copied,
  }
}

function definitionParams(view: AgentViewDefinition): JsonObject {
  const sort: Json[] = []

  for (const clause of view.sort) {
    sort.push(jsonObject({ field: clause.field, order: clause.order }))
  }

  if (view.filter !== undefined) {
    return jsonObject({
      source: view.source,
      label: view.label,
      sort,
      filter: view.filter,
    })
  }

  return jsonObject({
    source: view.source,
    label: view.label,
    sort,
  })
}

export const installView = Effect.fnUntraced(function*(mode: string = "all", sort: string = "spaces") {
  const params = definitionParams(definition(mode, sort))
  const outcome = yield* rpcTryCall("agent.view.set", params)

  if (outcome.error !== undefined) {
    return {
      error: `${outcome.error.code}: ${outcome.error.message}`,
    } satisfies ViewInstallOutcome
  }

  return { result: outcome.result } satisfies ViewInstallOutcome
})

export const clearView = Effect.fnUntraced(function*() {
  const outcome = yield* rpcTryCall("agent.view.clear", jsonObject({ source: PLUGIN_ID }))

  if (outcome.error !== undefined) {
    return {
      error: `${outcome.error.code}: ${outcome.error.message}`,
    } satisfies ViewInstallOutcome
  }

  return { result: outcome.result } satisfies ViewInstallOutcome
})

const persistView = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
  mode: string,
  sort: string,
  logMessage: string,
) {
  const scope = normalizeScope(mode)
  const axis = normalizeSort(sort)
  const installed = yield* installView(scope, axis)

  if (installed.error !== undefined) {
    yield* pluginWarn(paths, output, `agent view failed: ${installed.error}`)

    return undefined
  }

  state.view_installed = true
  state.view_mode = scope
  state.sort_mode = axis
  save(statePath(paths.stateDir), state)
  yield* pluginLog(paths, output, logMessage)

  const label = installed.result === undefined ? undefined : installed.result.label
  const printed = Predicate.isString(label) ? label : "None"

  output.stdout.push(`agent focus: ${scope}; sort: ${axis} (${printed})`)

  return installed
})

export const runView = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const mode = argv[0] === "current" ? "current" : "all"

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    viewLocked(paths, output, mode),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "view: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const viewLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  mode: string,
) {
  const state = load(statePath(paths.stateDir))
  const sort = normalizeSort(state.sort_mode)

  const installed = yield* persistView(
    paths,
    output,
    state,
    mode,
    sort,
    `agent view installed (${mode}, ${sort})`,
  )

  return installed === undefined ? 1 : 0
})

export const runToggleAgentFocus = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  if (argv.length > 0) {
    yield* pluginWarn(paths, output, "usage: toggle-agent-focus")

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    toggleFocusLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "toggle-agent-focus: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const toggleFocusLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const state = load(statePath(paths.stateDir))
  const focused = state.view_installed && state.view_mode === "current"
  const mode = focused ? "all" : "current"
  const sort = normalizeSort(state.sort_mode)

  const installed = yield* persistView(
    paths,
    output,
    state,
    mode,
    sort,
    `agent focus toggled (${mode}, ${sort})`,
  )

  return installed === undefined ? 1 : 0
})

export const runToggleAgentSort = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  if (argv.length > 0) {
    yield* pluginWarn(paths, output, "usage: toggle-agent-sort")

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    toggleSortLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "toggle-agent-sort: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const toggleSortLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const state = load(statePath(paths.stateDir))
  const mode = normalizeScope(state.view_mode)
  const current = normalizeSort(state.sort_mode)
  const sort = current === "activity" ? "spaces" : "activity"

  const installed = yield* persistView(
    paths,
    output,
    state,
    mode,
    sort,
    `agent sort toggled (${mode}, ${sort})`,
  )

  return installed === undefined ? 1 : 0
})

export const runSort = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  if (argv.length === 0) {
    const state = load(statePath(paths.stateDir))

    output.stdout.push(
      `sort: ${normalizeSort(state.sort_mode)} (activity or spaces); focus: ${normalizeScope(state.view_mode)}`,
    )

    return commandResult(0, output)
  }

  const requested = argv[0]

  if (argv.length !== 1 || (requested !== "activity" && requested !== "spaces")) {
    yield* pluginWarn(paths, output, "usage: sort [activity|spaces]")

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    sortLocked(paths, output, requested),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "sort: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const sortLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  sort: SortMode,
) {
  const state = load(statePath(paths.stateDir))
  const mode = normalizeScope(state.view_mode)

  const installed = yield* persistView(
    paths,
    output,
    state,
    mode,
    sort,
    `agent sort set (${mode}, ${sort})`,
  )

  return installed === undefined ? 1 : 0
})

export const runViewClear = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    viewClearLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "view-clear: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const viewClearLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const state = load(statePath(paths.stateDir))

  if (!state.view_installed) {
    output.stdout.push("this plugin does not own an agent view; leaving it alone")

    return 0
  }

  const cleared = yield* clearView()

  if (cleared.error !== undefined) {
    yield* pluginWarn(paths, output, `agent view clear failed: ${cleared.error}`)

    return 1
  }

  state.view_installed = false
  save(statePath(paths.stateDir), state)
  yield* pluginLog(paths, output, "agent view cleared")
  output.stdout.push("agent view cleared")

  return 0
})
