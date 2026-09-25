import { existsSync, readFileSync } from "node:fs"

import { Predicate, Result, Schema } from "effect"

import { atomicWrite } from "../runtime/lock.ts"
import { PALETTE } from "../spaces/palette.ts"

export const SCHEMA_VERSION = 1

type Json = typeof Schema.Json.Type

export type JsonObject = typeof Schema.JsonObject.Type

export type MutableJsonObject = { [key: string]: Json }

export type ViewMode = "all" | "current"

export type SortMode = "activity" | "spaces"

export type BackupKeyRecord =
  | { readonly present: false }
  | { readonly present: true; readonly value: Json }

export type BackupRecord = {
  readonly keys: { readonly [dotted: string]: BackupKeyRecord }
  readonly captured_unix: number
}

export interface PluginState {
  [key: string]: Json
  version: number
  identities: MutableJsonObject
  alloc_cursor: number
  tint_enabled: boolean
  view_mode: ViewMode
  sort_mode: SortMode
  view_installed: boolean
  sidebar_installed: boolean
  theme_backup: Json
  sidebar_backup: Json
  ownership_baseline: Json
  last_written: MutableJsonObject
  last_tint: Json
  window_title_set: boolean
  keybind_installed: boolean
  keybind_key: Json
  sort_keybind_installed: boolean
  sort_keybind_key: Json
  idle_keybind_installed: boolean
  idle_keybind_key: Json
  oldest_idle_keybind_installed: boolean
  oldest_idle_keybind_key: Json
  nav_keybinds: MutableJsonObject
  prune_keybind_installed: boolean
  prune_keybind_key: Json
  pane_move_keybind_installed: boolean
  pane_move_keybind_key: Json
  promote_pane_keybind_installed: boolean
  promote_pane_keybind_key: Json
  pending_pane_move: Json
  idle_cycle_last_pane_id: Json
  idle_navigation_heads: Json
  agent_settled: MutableJsonObject
}

const PALETTE_HEX = new Set<string>(PALETTE.map(([, hex]) => hex))

export function defaultState(): PluginState {
  return {
    version: SCHEMA_VERSION,
    identities: {},
    alloc_cursor: 0,
    tint_enabled: false,
    view_mode: "all",
    sort_mode: "spaces",
    view_installed: false,
    sidebar_installed: false,
    theme_backup: null,
    sidebar_backup: null,
    ownership_baseline: null,
    last_written: {},
    last_tint: null,
    window_title_set: false,
    keybind_installed: false,
    keybind_key: null,
    sort_keybind_installed: false,
    sort_keybind_key: null,
    idle_keybind_installed: false,
    idle_keybind_key: null,
    oldest_idle_keybind_installed: false,
    oldest_idle_keybind_key: null,
    nav_keybinds: {},
    prune_keybind_installed: false,
    prune_keybind_key: null,
    pane_move_keybind_installed: false,
    pane_move_keybind_key: null,
    promote_pane_keybind_installed: false,
    promote_pane_keybind_key: null,
    pending_pane_move: null,
    idle_cycle_last_pane_id: null,
    idle_navigation_heads: {},
    agent_settled: {},
  }
}

export function load(path: string): PluginState {
  if (!existsSync(path)) return defaultState()

  let text: string

  try {
    text = readFileSync(path, "utf8")
  } catch {
    return defaultState()
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return defaultState()
  }

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

  if (Result.isFailure(decoded)) return defaultState()

  return mergeLoaded(decoded.success)
}

export function dumpState(data: PluginState): string {
  return `${JSON.stringify(sortJsonKeys(data), null, 2)}\n`
}

export function save(path: string, data: PluginState): void {
  atomicWrite(path, dumpState(data))
}

export function identityOf(data: PluginState, workspaceId: string): JsonObject | undefined {
  const value = data.identities[workspaceId]

  if (value === undefined) return undefined

  return jsonObject(value)
}

export function setIdentity(
  data: PluginState,
  workspaceId: string,
  colour: string,
  origin = "manual",
): JsonObject {
  const record: JsonObject = { colour, origin }

  data.identities[workspaceId] = record

  return record
}

function mergeLoaded(loaded: JsonObject): PluginState {
  const base = defaultState()

  Object.assign(base, loaded)
  base.version = SCHEMA_VERSION

  const identities = jsonObject(base.identities)
  base.identities = identities === undefined ? {} : migrateIdentities(identities)

  const settled = jsonObject(base.agent_settled)
  base.agent_settled = settled === undefined ? {} : settled

  const navigation = jsonObject(base.nav_keybinds)
  base.nav_keybinds = navigation === undefined ? {} : navigation

  base.view_mode = normalizeScope(base.view_mode)
  base.sort_mode = normalizeSort(base.sort_mode)

  return base
}

function migrateIdentities(identities: JsonObject): JsonObject {
  const next: { [workspaceId: string]: Json } = {}

  for (const workspaceId of Object.keys(identities)) {
    const info = identities[workspaceId]

    if (info === undefined) continue

    const record = jsonObject(info)

    if (record === undefined) continue

    const migrated: { [key: string]: Json } = {}

    for (const key of Object.keys(record)) {
      if (key === "emoji") continue

      const nested = record[key]

      if (nested === undefined) continue

      migrated[key] = nested
    }

    const colourValue = migrated.colour
    const colour = Predicate.isString(colourValue) ? colourValue.toLowerCase() : ""

    if (colour === "") continue

    const origin = migrated.origin
    const keepOutsidePalette = origin === "manual" || origin === "label"

    if (!keepOutsidePalette && !PALETTE_HEX.has(colour)) continue

    next[workspaceId] = migrated
  }

  return next
}

function normalizeScope(mode: Json): ViewMode {
  return mode === "current" ? "current" : "all"
}

function normalizeSort(sort: Json): SortMode {
  return sort === "activity" ? "activity" : "spaces"
}

function jsonObject(value: Json): JsonObject | undefined {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function sortJsonKeys(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys)
  }

  const object = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(object)) return value

  const sorted: { [key: string]: Json } = {}

  for (const key of Object.keys(object.success).sort()) {
    const nested = object.success[key]

    if (nested === undefined) continue

    sorted[key] = sortJsonKeys(nested)
  }

  return sorted
}
