import { Predicate, Result, Schema } from "effect"

type Json = typeof Schema.Json.Type

type JsonObject = typeof Schema.JsonObject.Type

export const ELAPSED_WIDTH = 3

export const ELAPSED_PAD = "\u2800"

export const ELAPSED_BLANK = `${ELAPSED_PAD}${ELAPSED_PAD}${ELAPSED_PAD}`

export function fitWidth(label: string): string {
  if (label.length >= ELAPSED_WIDTH) return label

  return `${label}${ELAPSED_PAD.repeat(ELAPSED_WIDTH - label.length)}`
}

export function formatElapsed(seconds: number): string {
  let label: string

  if (seconds < 30) {
    label = "now"
  } else if (seconds < 3600) {
    label = `${Math.floor((seconds + 30) / 60)}m`
  } else if (seconds < 86400) {
    label = `${Math.floor((seconds + 1800) / 3600)}h`
  } else {
    let days = Math.floor((seconds + 43200) / 86400)

    if (days > 99) days = 99

    label = `${days}d`
  }

  return fitWidth(label)
}

function jsonObject(value: Json | undefined): JsonObject | undefined {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function settledAt(record: Json | undefined): number | undefined {
  const object = jsonObject(record)

  if (object === undefined) return undefined

  const at = object.last_settled_at

  if (!Predicate.isNumber(at) || !Number.isInteger(at) || at < 0) return undefined

  return at
}

export type ElapsedLabel = {
  readonly paneId: string
  readonly label: string
}

export function elapsedLabels(
  records: JsonObject,
  paneIds: readonly string[],
  now: number,
): ElapsedLabel[] {
  const result: ElapsedLabel[] = []

  for (const paneId of paneIds) {
    const at = settledAt(records[paneId])

    result.push({
      paneId,
      label: at === undefined ? ELAPSED_BLANK : formatElapsed(Math.max(0, now - at)),
    })
  }

  return result
}

export function elapsedLabelFor(labels: readonly ElapsedLabel[], paneId: string): string {
  for (const item of labels) {
    if (item.paneId === paneId) return item.label
  }

  return ELAPSED_BLANK
}
