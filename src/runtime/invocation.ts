import { Effect, Predicate, Result, Schema } from "effect"

import type { PluginPathValues } from "./paths.ts"
import { focusedWorkspace } from "./rpc.ts"

export function workspaceIdFromContextJson(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

    if (Result.isFailure(decoded)) return undefined

    const value = decoded.success.workspace_id

    return Predicate.isString(value) && value !== "" ? value : undefined
  } catch {
    return undefined
  }
}

export function paneIdFromContextJson(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

    if (Result.isFailure(decoded)) return undefined

    const focused = decoded.success.focused_pane_id
    const pane = decoded.success.pane_id

    if (Predicate.isString(focused) && focused !== "") return focused

    if (Predicate.isString(pane) && pane !== "") return pane

    return undefined
  } catch {
    return undefined
  }
}

export const resolveContextWorkspace = Effect.fnUntraced(function*(paths: PluginPathValues) {
  const fromContext = workspaceIdFromContextJson(paths.contextJson)

  if (fromContext !== undefined) return fromContext

  const focused = yield* focusedWorkspace()
  const id = focused === undefined ? undefined : focused.workspace_id

  return Predicate.isString(id) && id !== "" ? id : undefined
})
