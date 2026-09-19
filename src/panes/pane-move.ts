import { join } from "node:path"

import { Effect, Predicate, Result, Schema } from "effect"

import { PLUGIN_ID } from "../ids.ts"
import { FlockError, LockTimeout, PaneMoveError, RpcTransportError } from "../runtime/errors.ts"
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
import { listPanes, listWorkspaces, rpcCall, rpcTryCall, type JsonObject } from "../runtime/rpc.ts"
import { load, save, type PluginState } from "../state/store.ts"
import { isEscape, type Key } from "../terminal/keys.ts"
import { addnstr, emptyScreen, type Screen } from "../terminal/screen.ts"
import { runRawLoop, type LoopEvent } from "../terminal/session.ts"

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

function quotedRepr(value: string): string {
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

function errorText(error: PaneMoveError | RpcTransportError | FlockError | LockTimeout | Error): string {
  if (error instanceof PaneMoveError) return error.message

  if (error instanceof RpcTransportError) return `${error.code}: ${error.message}`

  if (error instanceof LockTimeout) return "timed out waiting for plugin lock"

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

export function paneDetails(
  paneId: string,
  panes: ReadonlyMap<string, JsonObject>,
  workspaceNames: { readonly [id: string]: string },
): readonly [string, string] {
  const pane = panes.get(paneId)

  if (pane === undefined) return [paneId, "No longer available"]

  const title = Predicate.isString(pane.terminal_title_stripped) && pane.terminal_title_stripped !== ""
    ? pane.terminal_title_stripped
    : Predicate.isString(pane.terminal_title) && pane.terminal_title !== ""
      ? pane.terminal_title
      : paneId

  const workspaceId = Predicate.isString(pane.workspace_id) && pane.workspace_id !== ""
    ? pane.workspace_id
    : "?"

  const workspace = workspaceNames[workspaceId] ?? workspaceId

  return [title, `${workspace}  ·  ${paneId}`]
}

export type PaneMoveUi = {
  readonly sourceId: string
  readonly destinationId: string
  notice: string
  panes: Map<string, JsonObject>
  workspaceNames: { [id: string]: string }
}

export type PaneMoveIntent =
  | { readonly type: "continue"; readonly state: PaneMoveUi }
  | { readonly type: "place"; readonly placement: Placement }
  | { readonly type: "cancel" }

export function handlePaneMoveKey(state: PaneMoveUi, key: Key): PaneMoveIntent {
  if (isEscape(key)) return { type: "cancel" }

  if (key.type === "char") {
    const placement = placementForKey(key.code)

    if (placement !== undefined) return { type: "place", placement }
  }

  return { type: "continue", state }
}

export function renderPaneMove(state: PaneMoveUi, rows: number, cols: number): Screen {
  const screen = emptyScreen(rows, cols)
  const limit = Math.max(0, cols - 4)
  const source = paneDetails(state.sourceId, state.panes, state.workspaceNames)
  const destination = paneDetails(state.destinationId, state.panes, state.workspaceNames)

  addnstr(screen, 1, 2, "FROM", limit, { dim: true })
  addnstr(screen, 2, 3, `• ${source[0]}`, Math.max(0, limit - 1), { bold: true })
  addnstr(screen, 3, 5, source[1], Math.max(0, limit - 3), { dim: true })
  addnstr(screen, 4, 3, "↓", Math.max(0, limit - 1), { dim: true })
  addnstr(screen, 5, 2, "TO", limit, { dim: true })
  addnstr(screen, 6, 3, `• ${destination[0]}`, Math.max(0, limit - 1), { bold: true })
  addnstr(screen, 7, 5, destination[1], Math.max(0, limit - 3), { dim: true })

  if (state.notice !== "") {
    addnstr(screen, rows - 4, 2, state.notice, limit, { bold: true })
  }

  addnstr(screen, rows - 3, 2, "─".repeat(limit), limit, { dim: true })
  addnstr(screen, rows - 1, 2, "[S]", 3, { reverse: true, bold: true })
  addnstr(screen, rows - 1, 6, "Split right", 13, { bold: true })
  addnstr(screen, rows - 1, 22, "[T]", 3, { reverse: true, bold: true })
  addnstr(screen, rows - 1, 26, "New tab", 10, { bold: true })
  addnstr(screen, rows - 1, 40, "[Q]", 3, { reverse: true, bold: true })
  addnstr(screen, rows - 1, 44, "Cancel", 10, { bold: true })

  return screen
}

function noticeForOutcome(outcome: MoveOutcome): string {
  if (outcome === "source_missing") return "Selected pane no longer exists; move cancelled."

  if (outcome === "destination_missing") {
    return "Destination pane no longer exists. Press q to cancel."
  }

  return "Choose another pane to split beside, or press t for a new tab."
}

const reloadPopup = Effect.fnUntraced(function*(state: PaneMoveUi) {
  const names: { [id: string]: string } = {}

  for (const workspace of yield* listWorkspaces()) {
    const id = workspace.workspace_id

    if (!Predicate.isString(id) || id === "") continue

    const label = workspace.label

    names[id] = Predicate.isString(label) && label !== "" ? label : id
  }

  state.panes = panesById(yield* listPanes())
  state.workspaceNames = names
})

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
    return yield* new PaneMoveError({ message: `unknown placement ${quotedRepr(placement)}` })
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

  const state: PaneMoveUi = {
    sourceId,
    destinationId,
    notice: "",
    panes: new Map(),
    workspaceNames: {},
  }

  yield* reloadPopup(state)

  const result = yield* runRawLoop(state, renderPaneMove, (current, key) =>
    Effect.gen(function*() {
      const intent = handlePaneMoveKey(current, key)

      if (intent.type === "cancel") {
        yield* withExclusiveLock(
          pluginLockPath(paths.stateDir),
          cancelPending(sourceId),
        ).pipe(Effect.catchTags({
          LockTimeout: () => Effect.void,
          FlockError: () => Effect.void,
        }))

        return { type: "stop", code: 0, stdout: "", stderr: "" } as const satisfies LoopEvent<PaneMoveUi>
      }

      if (intent.type === "place") {
        const placed = yield* withExclusiveLock(
          pluginLockPath(paths.stateDir),
          confirmMove(sourceId, destinationId, intent.placement),
        ).pipe(Effect.result)

        if (Result.isFailure(placed)) {
          current.notice = `Move failed: ${errorText(placed.failure)}`

          return { type: "continue", state: current } as const satisfies LoopEvent<PaneMoveUi>
        }

        if (placed.success === "moved" || placed.success === "source_missing") {
          if (placed.success === "source_missing") {
            current.notice = noticeForOutcome(placed.success)
          }

          return {
            type: "stop",
            code: 0,
            stdout: "",
            stderr: "",
          } as const satisfies LoopEvent<PaneMoveUi>
        }

        current.notice = noticeForOutcome(placed.success)
        yield* reloadPopup(current)

        return { type: "continue", state: current } as const satisfies LoopEvent<PaneMoveUi>
      }

      return { type: "continue", state: intent.state } as const satisfies LoopEvent<PaneMoveUi>
    }),
  ).pipe(
    Effect.catchTag("NotATty", () =>
      Effect.succeed({
        code: 1,
        stdout: "",
        stderr: "pane-move needs a terminal; run it through the Mosaic action.\n",
      }),
    ),
  )

  return { code: result.code, stdout: result.stdout, stderr: result.stderr } as const
})
