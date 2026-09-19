import { join } from "node:path"

import { Effect, Predicate, Result, Schema } from "effect"

import { PLUGIN_ID } from "../ids.ts"
import { FlockError, PaneMoveError, RpcTransportError } from "../runtime/errors.ts"
import { paneIdFromContextJson } from "../runtime/invocation.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { listPanes, rpcCall, rpcTryCall, type JsonObject } from "../runtime/rpc.ts"
import { load, save, type PluginState } from "../state/store.ts"

type Json = typeof Schema.Json.Type

export type Placement = "split" | "tab"

export type MoveOutcome = "moved" | "source_missing" | "destination_missing" | "same_pane"

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

function pythonRepr(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

function asObject(value: Json | undefined): JsonObject | undefined {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function asJsonObject(value: Json): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return {}

  return decoded.success
}

function errorText(error: PaneMoveError | RpcTransportError | FlockError | Error): string {
  if (error instanceof PaneMoveError) return error.message

  if (error instanceof RpcTransportError) return `${error.code}: ${error.message}`

  return error.message
}

function focusedPaneId(paths: PluginPathValues): string | undefined {
  if (paths.paneId !== undefined && paths.paneId !== "") return paths.paneId

  return paneIdFromContextJson(paths.contextJson)
}

export function pendingSource(state: PluginState): string | undefined {
  const record = asObject(state.pending_pane_move)

  if (record === undefined) return undefined

  const paneId = record.pane_id

  return Predicate.isString(paneId) && paneId !== "" ? paneId : undefined
}

export function setPending(state: PluginState, paneId: string): void {
  state.pending_pane_move = asJsonObject({ pane_id: paneId })
}

export function clearPending(state: PluginState, sourceId?: string): boolean {
  const current = pendingSource(state)

  if (sourceId !== undefined && current !== sourceId) return false

  if (!Object.hasOwn(state, "pending_pane_move")) return false

  state.pending_pane_move = null

  return true
}

function panesById(panes: readonly JsonObject[]): Map<string, JsonObject> {
  const out = new Map<string, JsonObject>()

  for (const pane of panes) {
    const paneId = pane.pane_id

    if (Predicate.isString(paneId) && paneId !== "") out.set(paneId, pane)
  }

  return out
}

function newTabDestination(destination: JsonObject): JsonObject | PaneMoveError {
  const workspaceId = destination.workspace_id

  if (!Predicate.isString(workspaceId) || workspaceId === "") {
    return new PaneMoveError({ message: "destination pane has no workspace" })
  }

  return asJsonObject({ type: "new_tab", workspace_id: workspaceId })
}

function rightSplitDestination(destination: JsonObject): JsonObject | PaneMoveError {
  const tabId = destination.tab_id
  const paneId = destination.pane_id

  if (!Predicate.isString(tabId) || tabId === "" || !Predicate.isString(paneId) || paneId === "") {
    return new PaneMoveError({ message: "destination pane has no tab" })
  }

  return asJsonObject({
    type: "tab",
    tab_id: tabId,
    target_pane_id: paneId,
    split: "right",
    ratio: 0.5,
  })
}

export function placementForKey(key: number): Placement | undefined {
  if (key === "s".charCodeAt(0) || key === "S".charCodeAt(0)) return "split"

  if (key === "t".charCodeAt(0) || key === "T".charCodeAt(0)) return "tab"

  return undefined
}

const notice = Effect.fnUntraced(function*(body: string) {
  yield* rpcTryCall("notification.show", {
    title: "Mosaic",
    body,
    sound: "none",
  })
})

const moveResult = Effect.fnUntraced(function*(paneId: string, destination: JsonObject) {
  const payload = yield* rpcCall("pane.move", {
    pane_id: paneId,
    destination,
    focus: true,
  })

  const outcome = asObject(payload.move_result) ?? {}

  if (outcome.changed !== true) {
    const reason = Predicate.isString(outcome.reason) && outcome.reason !== ""
      ? outcome.reason
      : "move rejected"

    return yield* new PaneMoveError({ message: `pane.move: ${reason}` })
  }

  return outcome
})

const captureOrOpenLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const state = load(statePath(paths.stateDir))
  const destinationId = focusedPaneId(paths)
  const panes = panesById(yield* listPanes())
  const sourceId = pendingSource(state)

  if (sourceId !== undefined) {
    if (!panes.has(sourceId)) {
      clearPending(state, sourceId)
      save(statePath(paths.stateDir), state)
      yield* notice("The selected pane is no longer available.")

      return 0
    }

    if (destinationId === undefined || !panes.has(destinationId)) {
      yield* notice("Focus a destination pane, then press prefix+/ again.")

      return 1
    }

    const opened = yield* rpcTryCall("plugin.pane.open", {
      plugin_id: PLUGIN_ID,
      entrypoint: "pane-move",
      focus: true,
      placement: "popup",
      env: asJsonObject({
        MOSAIC_PANE_MOVE_SOURCE: sourceId,
        MOSAIC_PANE_MOVE_DESTINATION: destinationId,
      }),
    })

    if (opened.error !== undefined) {
      yield* pluginWarn(
        paths,
        output,
        `could not open pane move confirmation: ${opened.error.code}: ${opened.error.message}`,
      )

      return 1
    }

    return 0
  }

  if (destinationId === undefined || !panes.has(destinationId)) {
    yield* pluginWarn(paths, output, "pane move requires a focused pane")

    return 1
  }

  setPending(state, destinationId)
  save(statePath(paths.stateDir), state)
  yield* notice("Pane selected. Navigate, then press prefix+/ again.")

  return 0
})

const promoteFocusedLocked = Effect.fnUntraced(function*(paths: PluginPathValues) {
  const paneId = focusedPaneId(paths)

  if (paneId === undefined) {
    return yield* new PaneMoveError({ message: "promote requires a focused pane" })
  }

  const pane = panesById(yield* listPanes()).get(paneId)

  if (pane === undefined) {
    return yield* new PaneMoveError({ message: "promote requires a focused pane" })
  }

  const destination = newTabDestination(pane)

  if (destination instanceof PaneMoveError) return yield* destination

  yield* moveResult(paneId, destination)

  return 0
})

export const confirmMove = Effect.fnUntraced(function*(
  sourceId: string,
  destinationId: string,
  placement: string,
) {
  const paths = yield* PluginPaths

  if (placement !== "split" && placement !== "tab") {
    return yield* new PaneMoveError({ message: `unknown placement ${pythonRepr(placement)}` })
  }

  const state = load(statePath(paths.stateDir))
  const panes = panesById(yield* listPanes())
  const source = panes.get(sourceId)

  if (source === undefined) {
    clearPending(state, sourceId)
    save(statePath(paths.stateDir), state)

    return "source_missing" satisfies MoveOutcome
  }

  const destination = panes.get(destinationId)

  if (destination === undefined) return "destination_missing" satisfies MoveOutcome

  if (placement === "split" && sourceId === destinationId) {
    return "same_pane" satisfies MoveOutcome
  }

  const target = placement === "split"
    ? rightSplitDestination(destination)
    : newTabDestination(destination)

  if (target instanceof PaneMoveError) return yield* target

  yield* moveResult(sourceId, target)
  clearPending(state, sourceId)
  save(statePath(paths.stateDir), state)

  return "moved" satisfies MoveOutcome
})

export const cancelPending = Effect.fnUntraced(function*(sourceId: string) {
  const paths = yield* PluginPaths
  const state = load(statePath(paths.stateDir))

  if (clearPending(state, sourceId)) save(statePath(paths.stateDir), state)
})

const reportFailure = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  prefix: string,
  error: PaneMoveError | RpcTransportError | FlockError,
) {
  yield* pluginWarn(paths, output, `${prefix}: ${errorText(error)}`)

  return 1
})

export const runCaptureOrOpen = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  if (argv.length > 0) {
    yield* pluginWarn(paths, output, "usage: move-pane")

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    captureOrOpenLocked(paths, output),
  ).pipe(
    Effect.catchTags({
      RpcTransportError: (error) => reportFailure(paths, output, "pane move", error),
      FlockError: (error) => reportFailure(paths, output, "pane move", error),
      LockTimeout: () =>
        pluginWarn(paths, output, "timed out waiting for plugin lock").pipe(Effect.as(1)),
    }),
  )

  return commandResult(code, output)
})

export const runPromotePane = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  if (argv.length > 0) {
    yield* pluginWarn(paths, output, "usage: promote-pane")

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    promoteFocusedLocked(paths),
  ).pipe(
    Effect.catchTags({
      PaneMoveError: (error) => reportFailure(paths, output, "promote pane", error),
      RpcTransportError: (error) => reportFailure(paths, output, "promote pane", error),
      FlockError: (error) => reportFailure(paths, output, "promote pane", error),
      LockTimeout: () =>
        pluginWarn(paths, output, "timed out waiting for plugin lock").pipe(Effect.as(1)),
    }),
  )

  return commandResult(code, output)
})

export const runPaneMove = Effect.fnUntraced(function*(argv: readonly string[]) {
  const output = emptyOutput()

  if (argv.length > 0) {
    output.stderr.push("usage: pane-move")

    return commandResult(1, output)
  }

  const paths = yield* PluginPaths
  const sourceId = paths.paneMoveSource
  const destinationId = paths.paneMoveDestination

  if (sourceId === undefined || sourceId === "" || destinationId === undefined || destinationId === "") {
    output.stderr.push("pane-move requires source and destination pane IDs")

    return commandResult(1, output)
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    output.stderr.push("pane-move needs a terminal; run it through the Mosaic action.")

    return commandResult(1, output)
  }

  output.stderr.push("pane-move confirmation UI is not implemented in this TypeScript candidate")

  return commandResult(1, output)
})
