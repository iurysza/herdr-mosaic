import { existsSync, readFileSync } from "node:fs"

import { Result, Schema } from "effect"

import { MigrationError } from "../runtime/errors.ts"
import { type JsonObject } from "./json.ts"

export function readJsonObject(path: string): JsonObject | undefined {
  if (!existsSync(path)) return undefined

  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)

    throw new MigrationError({ message: `unreadable ${path}: ${detail}` })
  }

  if (parsed === null) return undefined

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

  if (Result.isFailure(decoded)) {
    throw new MigrationError({ message: `${path} is not a JSON object` })
  }

  return decoded.success
}
