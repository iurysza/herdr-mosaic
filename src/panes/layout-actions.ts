import { Effect, Predicate, Result, Schema } from "effect"

import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import { FlockError, LayoutError, RpcTransportError } from "../runtime/errors.ts"
import { paneIdFromContextJson } from "../runtime/invocation.ts"
import {
  emptyOutput,
  joinOutput,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { rpcCall, rpcTryCall, type JsonObject } from "../runtime/rpc.ts"
import {
  firstPane,
  insertionPlan,
  paneIds,
  same,
  targetFor,
  type LayoutNode,
} from "./layouts.ts"

type Json = typeof Schema.Json.Type

export const RESIZE_AMOUNT = 0.02

const RESIZE_DIRECTIONS = {
  "resize-left": "left",
  "resize-down": "down",
  "resize-up": "up",
  "resize-right": "right",
} as const

export type ExportedLayout = {
  readonly tab_id: string
  readonly workspace_id: string
  readonly focused_pane_id: string
  readonly zoomed: boolean
  readonly root: LayoutNode
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

function paneContext(paths: PluginPathValues): string | undefined {
  if (paths.paneId !== undefined && paths.paneId !== "") return paths.paneId

  return paneIdFromContextJson(paths.contextJson)
}

function errorText(error: LayoutError | RpcTransportError | FlockError | Error): string {
  if (error instanceof LayoutError) return error.message

  if (error instanceof RpcTransportError) return `${error.code}: ${error.message}`

  return error.message
}

function parseNode(value: Json | undefined): LayoutNode {
  const object = asObject(value)

  if (object === undefined) {
    throw new LayoutError({ message: "layout.export returned no layout" })
  }

  if (object.type === "pane") {
    const paneId = object.pane_id

    if (!Predicate.isString(paneId) || paneId === "") {
      throw new LayoutError({ message: "layout contains a pane without an id" })
    }

    return { type: "pane", pane_id: paneId }
  }

  if (object.type === "split") {
    const direction = object.direction
    const ratio = object.ratio

    if (!Predicate.isString(direction) || !Predicate.isNumber(ratio)) {
      throw new LayoutError({ message: "layout.export returned no layout" })
    }

    return {
      type: "split",
      direction,
      ratio,
      first: parseNode(object.first),
      second: parseNode(object.second),
    }
  }

  throw new LayoutError({ message: "layout.export returned no layout" })
}

function parseExportedLayout(value: JsonObject): ExportedLayout {
  const tabId = value.tab_id
  const workspaceId = value.workspace_id
  const focused = value.focused_pane_id

  if (!Predicate.isString(tabId) || tabId === "") {
    throw new LayoutError({ message: "layout.export returned no layout" })
  }

  if (!Predicate.isString(workspaceId) || workspaceId === "") {
    throw new LayoutError({ message: "layout.export returned no layout" })
  }

  if (!Predicate.isString(focused) || focused === "") {
    throw new LayoutError({ message: "layout.export returned no layout" })
  }

  return {
    tab_id: tabId,
    workspace_id: workspaceId,
    focused_pane_id: focused,
    zoomed: value.zoomed === true,
    root: parseNode(value.root),
  }
}

const notifyFailure = Effect.fnUntraced(function*(message: string) {
  yield* rpcTryCall("notification.show", {
    title: "Mosaic layouts failed",
    body: message,
    sound: "none",
  })
})

const exportLayout = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  tabId: string | undefined,
) {
  const paneId = tabId === undefined ? paneContext(paths) : undefined

  const payload = yield* rpcCall(
    "layout.export",
    tabId !== undefined
      ? asJsonObject({ tab_id: tabId })
      : paneId !== undefined
        ? asJsonObject({ pane_id: paneId })
        : {},
  )

  const layout = asObject(payload.layout)

  if (layout === undefined) {
    return yield* new LayoutError({ message: "layout.export returned no layout" })
  }

  try {
    return parseExportedLayout(layout)
  } catch (error) {
    if (error instanceof LayoutError) return yield* error

    if (error instanceof Error) {
      return yield* new LayoutError({ message: error.message })
    }

    return yield* new LayoutError({ message: "layout.export returned no layout" })
  }
})

function tabDestination(
  tabId: string,
  targetPaneId: string,
  direction: string,
  ratio: number,
): JsonObject {
  return asJsonObject({
    type: "tab",
    tab_id: tabId,
    target_pane_id: targetPaneId,
    split: direction,
    ratio,
  })
}

function newTabDestination(workspaceId: string, label: string): JsonObject {
  return asJsonObject({
    type: "new_tab",
    workspace_id: workspaceId,
    label,
  })
}

const movePane = Effect.fnUntraced(function*(
  paneId: string,
  destination: JsonObject,
  focus = false,
) {
  const payload = yield* rpcCall("pane.move", {
    pane_id: paneId,
    destination,
    focus,
  })

  const moveResult = asObject(payload.move_result) ?? {}

  if (moveResult.changed !== true) {
    const reason = Predicate.isString(moveResult.reason) && moveResult.reason !== ""
      ? moveResult.reason
      : "move rejected"

    return yield* new LayoutError({ message: `pane.move: ${reason}` })
  }

  return moveResult
})

function movedPaneId(moveResult: JsonObject, fallback: string): string {
  const pane = asObject(moveResult.pane)
  const paneId = pane === undefined ? undefined : pane.pane_id

  return Predicate.isString(paneId) && paneId !== "" ? paneId : fallback
}

function createdTabId(moveResult: JsonObject): string | undefined {
  const created = asObject(moveResult.created_tab)
  const tabId = created === undefined ? undefined : created.tab_id

  return Predicate.isString(tabId) && tabId !== "" ? tabId : undefined
}

const recover = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  stagingTab: string,
  originalTab: string,
  focusedPane: string,
) {
  const staged = paneIds((yield* exportLayout(paths, stagingTab)).root)
  const target = firstPane((yield* exportLayout(paths, originalTab)).root)

  for (const paneId of staged) {
    yield* movePane(
      paneId,
      tabDestination(originalTab, target, "right", 0.5),
      paneId === focusedPane,
    )
  }
})

const rearrangePanes = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  layout: ExportedLayout,
  target: LayoutNode,
) {
  const ids = paneIds(layout.root)

  if (ids.length < 2 || same(layout.root, target)) return

  if (layout.zoomed) {
    return yield* new LayoutError({ message: "unzoom the tab before changing its layout" })
  }

  const tabId = layout.tab_id
  const focused = layout.focused_pane_id
  const anchor = firstPane(target)
  const staged = ids.filter((paneId) => paneId !== anchor)
  const current = new Map<string, string>()

  for (const paneId of ids) current.set(paneId, paneId)

  const firstStaged = staged[0]

  if (firstStaged === undefined) return

  let stagingTab: string | undefined

  const applied = yield* Effect.gen(function*() {
    const firstMoved = yield* movePane(
      firstStaged,
      newTabDestination(layout.workspace_id, `layout-staging-${process.pid}`),
    )

    const created = createdTabId(firstMoved)

    if (created === undefined) {
      return yield* new LayoutError({ message: "pane.move did not create a staging tab" })
    }

    stagingTab = created
    current.set(firstStaged, movedPaneId(firstMoved, firstStaged))
    const stagingTarget = current.get(firstStaged) ?? firstStaged

    for (const paneId of staged.slice(1)) {
      const liveId = current.get(paneId) ?? paneId

      const moved = yield* movePane(
        liveId,
        tabDestination(created, stagingTarget, "right", 0.5),
      )

      current.set(paneId, movedPaneId(moved, liveId))
    }

    for (const step of insertionPlan(target)) {
      const sourceLive = current.get(step.sourceId) ?? step.sourceId
      const targetLive = current.get(step.targetId) ?? step.targetId

      const moved = yield* movePane(
        sourceLive,
        tabDestination(tabId, targetLive, step.direction, step.ratio),
        step.sourceId === focused,
      )

      current.set(step.sourceId, movedPaneId(moved, sourceLive))
    }

    stagingTab = undefined
  }).pipe(Effect.result)

  if (Result.isSuccess(applied)) return

  if (stagingTab !== undefined) {
    const focusedLive = current.get(focused) ?? focused
    const recovered = yield* recover(paths, stagingTab, tabId, focusedLive).pipe(Effect.result)

    if (Result.isFailure(recovered)) {
      output.stderr.push(
        `mosaic: recovery failed; panes remain in ${stagingTab}: ${errorText(recovered.failure)}`,
      )
    }
  }

  return yield* applied.failure
})

const runAction = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  action: string,
) {
  const direction = action === "resize-left"
    || action === "resize-down"
    || action === "resize-up"
    || action === "resize-right"
    ? RESIZE_DIRECTIONS[action]
    : undefined

  if (direction !== undefined) {
    const paneId = paneContext(paths)

    if (paneId === undefined) {
      return yield* new LayoutError({ message: "resize action requires a pane context" })
    }

    yield* rpcCall("pane.resize", {
      pane_id: paneId,
      direction,
      amount: RESIZE_AMOUNT,
    })

    return 0
  }

  if (action === "equalize" || action === "cycle") {
    const current = yield* exportLayout(paths, undefined)

    yield* rearrangePanes(paths, output, current, targetFor(action, current.root))

    return 0
  }

  return yield* new LayoutError({ message: `unknown layout action ${pythonRepr(action)}` })
})

const reportLayoutFailure = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  error: LayoutError | RpcTransportError | FlockError,
) {
  const message = errorText(error)

  yield* pluginWarn(paths, output, `layouts: ${message}`)
  yield* notifyFailure(message)
  output.stderr.push(`mosaic: ${message}`)

  return 1
})

export const runLayout = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const action = argv[0] ?? ""

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    runAction(paths, output, action),
  ).pipe(
    Effect.catchTags({
      LayoutError: (error) => reportLayoutFailure(paths, output, error),
      RpcTransportError: (error) => reportLayoutFailure(paths, output, error),
      FlockError: (error) => reportLayoutFailure(paths, output, error),
      LockTimeout: () =>
        pluginWarn(paths, output, "layout: timed out waiting for plugin lock").pipe(Effect.as(1)),
    }),
  )

  return commandResult(code, output)
})
