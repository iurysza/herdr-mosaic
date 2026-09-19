import { join } from "node:path"

import { Clock, Effect, Predicate, Result, Schema } from "effect"

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
  focusedWorkspace,
  listAgents,
  listWorkspaces,
  rpcTryCall,
  type JsonObject,
} from "../runtime/rpc.ts"
import { loadSettings } from "../runtime/settings.ts"
import { identityOf, load, save } from "../state/store.ts"
import { colourName, type WorkspaceSnapshot } from "../spaces/identity.ts"
import {
  agentFromRpc,
  markerGlyph,
  publishWorkspace,
  reconcileMetadata,
  republishPane,
  workspaceFromRpc,
  workspaceIdOfPane,
} from "../spaces/metadata.ts"
import { applyTint, ensureIdentity, setWindowTitle } from "../spaces/tint.ts"
import {
  applyLaunchToState,
  applyToState,
  forgetPane,
  parseLaunchEvent,
  parsePaneId,
  parseStatusEvent,
} from "./tracker.ts"

type Json = typeof Schema.Json.Type

const WORKSPACE_CHANGED = new Set([
  "workspace.created",
  "workspace.renamed",
  "workspace.updated",
  "workspace.moved",
  "workspace.reordered",
])

const PANE_CHANGED = new Set(["pane.created", "pane.moved", "pane.agent_detected"])

const PANE_GONE = new Set(["pane.closed", "pane.exited"])

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

function quotedRepr(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

function asObject(value: Json | undefined): JsonObject | undefined {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function isLegacyFalsy(value: Json): boolean {
  if (value === null || value === false || value === 0 || value === "") return true

  if (Array.isArray(value) && value.length === 0) return true

  const object = asObject(value)

  return object !== undefined && Object.keys(object).length === 0
}

function parseEventData(raw: string | undefined): JsonObject {
  if (raw === undefined || raw === "") return {}

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  const json = Schema.decodeUnknownResult(Schema.Json)(parsed)

  if (Result.isFailure(json)) return {}

  const root = asObject(json.success)

  if (root === undefined) return {}

  const nested = root.data

  if (nested === undefined || isLegacyFalsy(nested)) return root

  const inner = asObject(nested)

  if (inner === undefined) return {}

  return inner
}

function eventWorkspaceId(data: JsonObject): string | undefined {
  const nested = asObject(data.workspace)
  const fromNested = nested === undefined ? undefined : nested.workspace_id
  const fromRoot = data.workspace_id

  if (Predicate.isString(fromNested) && fromNested !== "") return fromNested

  if (Predicate.isString(fromRoot) && fromRoot !== "") return fromRoot

  return undefined
}

function lastTintWorkspaceId(lastTint: Json): string | undefined {
  const object = asObject(lastTint)
  const id = object === undefined ? undefined : object.workspace_id

  return Predicate.isString(id) ? id : undefined
}

function workspaceLabelOf(
  workspaceId: string,
  workspaces: readonly WorkspaceSnapshot[],
): string {
  for (const workspace of workspaces) {
    if (workspace.workspace_id === workspaceId) {
      return workspace.label || workspaceId
    }
  }

  return workspaceId
}

function withEventLock<E, R>(
  paths: PluginPathValues,
  output: CapturedOutput,
  body: Effect.Effect<number, E, R>,
) {
  return withExclusiveLock(pluginLockPath(paths.stateDir), body).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "timed out waiting for plugin lock").pipe(Effect.as(1)),
    ),
  )
}

const onWorkspaceFocused = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const state = load(statePath(paths.stateDir))
  const settings = loadSettings(paths)
  const focused = yield* focusedWorkspace()

  if (focused === undefined) return 0

  const workspaceId = Predicate.isString(focused.workspace_id) ? focused.workspace_id : undefined

  if (workspaceId === undefined || workspaceId === "") return 0

  const label = Predicate.isString(focused.label) && focused.label !== ""
    ? focused.label
    : workspaceId

  const ensured = yield* ensureIdentity(paths, output, state, workspaceId, undefined)
  const glyph = markerGlyph(paths)

  if (ensured.created) {
    yield* publishWorkspace(workspaceId, ensured.colour, glyph)
  }

  const changedSpace = lastTintWorkspaceId(state.last_tint) !== workspaceId

  if (changedSpace && settings.announce) {
    yield* rpcTryCall("notification.show", {
      title: `${glyph} ${label}`,
      body: colourName(ensured.colour),
      sound: "none",
    })
  }

  if (state.tint_enabled) {
    const tinted = yield* applyTint(paths, output, state, workspaceId, false, undefined)

    if (tinted.status === "applied" || (tinted.status === "noop" && changedSpace)) {
      yield* setWindowTitle(paths, output, state, label, settings)
    }
  } else if (settings.window_title && changedSpace) {
    yield* setWindowTitle(paths, output, state, label, settings)

    const previous = asObject(state.last_tint)

    const next = {
      workspace_id: workspaceId,
      values: previous === undefined ? null : previous.values ?? null,
    }

    const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(next)

    state.last_tint = Result.isSuccess(decoded) ? decoded.success : null
  }

  save(statePath(paths.stateDir), state)

  return 0
})

const onWorkspaceChanged = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  name: string,
  data: JsonObject,
) {
  const workspaceId = eventWorkspaceId(data)
  const state = load(statePath(paths.stateDir))
  const workspaces = (yield* listWorkspaces()).map(workspaceFromRpc)

  if (workspaceId !== undefined) {
    const ensured = yield* ensureIdentity(paths, output, state, workspaceId, workspaces)

    yield* publishWorkspace(workspaceId, ensured.colour, markerGlyph(paths))

    if (name === "workspace.renamed") {
      const agents = (yield* listAgents()).map(agentFromRpc)

      for (const agent of agents) {
        if (agent.workspace_id === workspaceId && agent.pane_id !== undefined) {
          yield* republishPane(paths, output, state, agent.pane_id, workspaces)
        }
      }

      yield* pluginLog(
        paths,
        output,
        `workspace ${workspaceId} renamed to ${quotedRepr(workspaceLabelOf(workspaceId, workspaces))}; `
          + `identity ${colourName(ensured.colour)} unchanged`,
      )
    } else if (ensured.created) {
      yield* pluginLog(
        paths,
        output,
        `workspace ${workspaceId} created; identity ${colourName(ensured.colour)}`,
      )
    }
  } else {
    yield* reconcileMetadata(paths, output, state, workspaces, undefined, true)
  }

  save(statePath(paths.stateDir), state)

  return 0
})

const onWorkspaceClosed = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  workspaceId: string,
) {
  const state = load(statePath(paths.stateDir))

  if (lastTintWorkspaceId(state.last_tint) === workspaceId) {
    state.last_tint = null
  }

  save(statePath(paths.stateDir), state)
  yield* pluginLog(paths, output, `workspace ${workspaceId} closed; identity retained`)

  return 0
})

const onAgentStatusChanged = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  data: JsonObject,
) {
  const parsed = parseStatusEvent(data)

  if (parsed === undefined) return 0

  const state = load(statePath(paths.stateDir))
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)

  if (applyToState(state, parsed.paneId, parsed.status, now)) {
    save(statePath(paths.stateDir), state)
  }

  return 0
})

function onPaneGone(paths: PluginPathValues, data: JsonObject) {
  return Effect.sync(() => {
    const paneId = parsePaneId(data)

    if (paneId === undefined) return 0

    const state = load(statePath(paths.stateDir))
    let changed = forgetPane(state, paneId)

    if (state.idle_cycle_last_pane_id === paneId) {
      state.idle_cycle_last_pane_id = null
      changed = true
    }

    if (changed) save(statePath(paths.stateDir), state)

    return 0
  })
}

const onPaneChanged = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  name: string,
  data: JsonObject,
) {
  const paneId = parsePaneId(data)

  if (paneId === undefined) return 0

  const state = load(statePath(paths.stateDir))
  let dirty = false

  if (name === "pane.agent_detected") {
    const launchId = parseLaunchEvent(data)

    if (launchId !== undefined) {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)

      dirty = applyLaunchToState(state, launchId, now)
    }
  }

  const agents = (yield* listAgents()).map(agentFromRpc)
  const isAgent = agents.some((agent) => agent.pane_id === paneId)

  if (!isAgent) {
    if (dirty) save(statePath(paths.stateDir), state)

    return 0
  }

  if (yield* republishPane(paths, output, state, paneId)) {
    if (name === "pane.moved") {
      const wid = workspaceIdOfPane(paneId)
      const info = wid === undefined ? undefined : identityOf(state, wid)
      const colour = Predicate.isString(info?.colour) ? info.colour : ""

      yield* pluginLog(
        paths,
        output,
        `pane ${paneId} moved; identity now ${colourName(colour)}`,
      )
    } else if (name === "pane.agent_detected") {
      yield* pluginLog(paths, output, `agent detected in ${paneId}; identity published`)
    }
  }

  save(statePath(paths.stateDir), state)

  return 0
})

export const runEvent = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const name = argv[0] ?? paths.eventName ?? ""
  const data = parseEventData(paths.eventJson)

  if (name === "workspace.focused") {
    const code = yield* withEventLock(paths, output, onWorkspaceFocused(paths, output))

    return commandResult(code, output)
  }

  if (WORKSPACE_CHANGED.has(name)) {
    const code = yield* withEventLock(paths, output, onWorkspaceChanged(paths, output, name, data))

    return commandResult(code, output)
  }

  if (name === "workspace.closed") {
    const workspaceId = eventWorkspaceId(data)

    if (workspaceId === undefined) return commandResult(0, output)

    const code = yield* withEventLock(paths, output, onWorkspaceClosed(paths, output, workspaceId))

    return commandResult(code, output)
  }

  if (PANE_CHANGED.has(name)) {
    if (parsePaneId(data) === undefined) return commandResult(0, output)

    const code = yield* withEventLock(paths, output, onPaneChanged(paths, output, name, data))

    return commandResult(code, output)
  }

  if (name === "tab.renamed") return commandResult(0, output)

  if (name === "pane.agent_status_changed") {
    if (parseStatusEvent(data) === undefined) return commandResult(0, output)

    const code = yield* withEventLock(paths, output, onAgentStatusChanged(paths, data))

    return commandResult(code, output)
  }

  if (PANE_GONE.has(name)) {
    if (parsePaneId(data) === undefined) return commandResult(0, output)

    const code = yield* withEventLock(paths, output, onPaneGone(paths, data))

    return commandResult(code, output)
  }

  yield* pluginWarn(paths, output, `unhandled event ${quotedRepr(name)}`)

  return commandResult(0, output)
})
