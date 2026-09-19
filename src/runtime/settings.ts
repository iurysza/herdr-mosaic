import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { Predicate, Result, Schema } from "effect"

import { atomicWrite } from "./lock.ts"
import type { PluginPathValues } from "./paths.ts"

type Json = typeof Schema.Json.Type

type JsonObject = typeof Schema.JsonObject.Type

type MutableJsonObject = { [key: string]: Json }

export type PluginSettings = {
  marker: Json
  intensity: Json
  theme_base: Json
  blend: Json
  tint_overlays: Json
  announce: Json
  window_title: Json
  window_title_suffix: Json
} & MutableJsonObject

export const DEFAULT_SETTINGS: PluginSettings = {
  marker: "■",
  intensity: "medium",
  theme_base: "auto",
  blend: {},
  tint_overlays: null,
  announce: false,
  window_title: true,
  window_title_suffix: " — Herdr",
}

export function settingsPath(paths: PluginPathValues): string {
  return join(paths.configDir, "settings.json")
}

export function loadSettings(paths: PluginPathValues): PluginSettings {
  const out = structuredClone(DEFAULT_SETTINGS)
  const path = settingsPath(paths)

  if (!existsSync(path)) return out

  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return out
  }

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

  if (Result.isFailure(decoded)) return out

  mergeSettings(out, decoded.success)

  return out
}

function emptyObject(): MutableJsonObject {
  return {}
}

export function saveSettings(paths: PluginPathValues, updates: JsonObject): PluginSettings {
  const path = settingsPath(paths)
  let current = emptyObject()

  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
      const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

      if (Result.isSuccess(decoded)) current = { ...decoded.success }
    } catch {
      current = emptyObject()
    }
  }

  mergeSettings(current, updates)
  atomicWrite(path, `${JSON.stringify(sortKeys(current), null, 2)}\n`)

  return loadSettings(paths)
}

function mergeSettings(target: MutableJsonObject, source: JsonObject): void {
  for (const key of Object.keys(source)) {
    const value = source[key]
    const existing = target[key]

    if (value === undefined) continue

    const valueObject = Schema.decodeUnknownResult(Schema.JsonObject)(value)
    const existingObject = Schema.decodeUnknownResult(Schema.JsonObject)(existing ?? null)

    if (Result.isSuccess(valueObject) && Result.isSuccess(existingObject)) {
      target[key] = { ...existingObject.success, ...valueObject.success }
      continue
    }

    target[key] = value
  }
}

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys)

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return value

  const sorted = emptyObject()

  for (const key of Object.keys(decoded.success).sort()) {
    const nested = decoded.success[key]

    if (nested === undefined) continue

    sorted[key] = sortKeys(nested)
  }

  return sorted
}

export function settingsString(settings: PluginSettings, key: string): string | undefined {
  const value = settings[key]

  return Predicate.isString(value) && value !== "" ? value : undefined
}
