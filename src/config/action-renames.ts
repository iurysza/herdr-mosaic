import { Predicate, Result, Schema } from "effect"

import type { ActionRenameRecord } from "./patch.ts"
import type { JsonObject, PluginState } from "../state/store.ts"

type Json = typeof Schema.Json.Type

function stringList(value: Json | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const lines: string[] = []

  for (const line of value) {
    if (!Predicate.isString(line)) return undefined

    lines.push(line)
  }

  return lines
}

export function actionRenamesOf(state: PluginState): ActionRenameRecord[] {
  const raw = state["action_renames"]
  const out: ActionRenameRecord[] = []

  if (!Array.isArray(raw)) return out

  for (const item of raw) {
    const object = Schema.decodeUnknownResult(Schema.JsonObject)(item)

    if (Result.isFailure(object)) continue

    const command = object.success.command
    const before = stringList(object.success.before)
    const after = stringList(object.success.after)

    if (!Predicate.isString(command) || before === undefined || after === undefined) continue

    const key = object.success.key

    out.push({
      key: Predicate.isString(key) ? key : undefined,
      command,
      before,
      after,
    })
  }

  return out
}

export function storeActionRenames(state: PluginState, records: readonly ActionRenameRecord[]): void {
  const items: Json[] = []

  for (const record of records) {
    const encoded: JsonObject = {
      key: record.key === undefined ? null : record.key,
      command: record.command,
      before: [...record.before],
      after: [...record.after],
    }

    items.push(encoded)
  }

  const decoded = Schema.decodeUnknownResult(Schema.Array(Schema.Json))(items)

  state["action_renames"] = Result.isSuccess(decoded) ? decoded.success : []
}

export function sameRenameLines(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false

  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }

  return true
}

export function sameRename(left: ActionRenameRecord, right: ActionRenameRecord): boolean {
  return left.command === right.command
    && left.key === right.key
    && sameRenameLines(left.before, right.before)
    && sameRenameLines(left.after, right.after)
}

export function findRename(
  saved: readonly ActionRenameRecord[],
  record: ActionRenameRecord,
): ActionRenameRecord | undefined {
  for (const item of saved) {
    if (item.key === record.key && item.command === record.command) return item
  }

  return undefined
}
