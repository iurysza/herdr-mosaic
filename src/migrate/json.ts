import { Result, Schema } from "effect"

type Json = typeof Schema.Json.Type

export type JsonObject = typeof Schema.JsonObject.Type

export function sortJson(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortJson)

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return value

  const sorted: { [key: string]: Json } = {}

  for (const key of Object.keys(decoded.success).sort()) {
    const nested = decoded.success[key]

    if (nested === undefined) continue

    sorted[key] = sortJson(nested)
  }

  return sorted
}

export function dumpReport(report: JsonObject): string {
  return `${JSON.stringify(sortJson(report), null, 2)}\n`
}

export function toJsonObject(value: Json): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isSuccess(decoded)) return decoded.success

  return {}
}

export function isTruthyJson(value: Json | undefined): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === "") {
    return false
  }

  if (Array.isArray(value) && value.length === 0) return false

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isSuccess(decoded) && Object.keys(decoded.success).length === 0) return false

  return true
}
