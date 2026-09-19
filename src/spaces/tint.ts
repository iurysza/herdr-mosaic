import { join } from "node:path"

import { Clock, Effect, Predicate, Result, Schema } from "effect"

import {
  applyValues,
  captureBackup,
  commitDoc,
  detectConflicts,
  dotted,
  loadDoc,
  restoreBackup,
  snapshotConfig,
} from "../config/patch.ts"
import { reloadConfig } from "../config/reload.ts"
import { backupFromJson, lastWrittenPairs } from "../config/sidebar.ts"
import { isMissing, isTomlString, tomlEqual, type TomlValue } from "../config/toml-edit.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginLog,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { focusedWorkspace, listWorkspaces, rpcTryCall, type JsonObject } from "../runtime/rpc.ts"
import { loadSettings, saveSettings, type PluginSettings } from "../runtime/settings.ts"
import { identityOf, load, save, type PluginState } from "../state/store.ts"
import { allocate, colourName, type WorkspaceSnapshot } from "./identity.ts"
import { tryApplyLabelRules } from "./labels.ts"
import { markerGlyph, publishWorkspace, reconcileMetadata, workspaceFromRpc } from "./metadata.ts"
import {
  INTENSITY_NAMES,
  OVERLAY_KEYS,
  TINT_KEYS,
  generate,
  intensityName,
  intensityPreset,
  isLightTheme,
  managedKeys,
  resolveBase,
  resolveOverlays,
  swatch,
  themeValue,
  type IntensityName,
  type ThemeValues,
} from "./theme.ts"

type Json = typeof Schema.Json.Type

export type TintStatus = "applied" | "noop" | "conflict" | "skip"

export type TintApplyResult = {
  readonly status: TintStatus
  readonly values: ThemeValues
}

export type ThemeRestoreResult = {
  readonly restored: ReadonlyArray<readonly [string, string]>
  readonly skipped: readonly string[]
}

export type IdentityEnsureResult = {
  readonly colour: string
  readonly created: boolean
  readonly workspaces: readonly WorkspaceSnapshot[]
}

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

function valueRepr(value: TomlValue | undefined): string {
  if (value === undefined) return "None"

  if (Predicate.isString(value)) return quotedRepr(value)

  return quotedRepr(String(value))
}

function jsonObject(value: Json | undefined): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isSuccess(decoded)) return decoded.success

  return {}
}

function backupToJson(value: ReturnType<typeof captureBackup>): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(value))
  const decoded = Schema.decodeUnknownResult(Schema.Json)(parsed)

  if (Result.isFailure(decoded)) return null

  return decoded.success
}

function themeNameOf(doc: ReturnType<typeof loadDoc>): string | undefined {
  const value = doc.get(["theme", "name"])

  if (isMissing(value) || !isTomlString(value)) return undefined

  return value
}

function themeValuesObject(values: ThemeValues): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(Object.fromEntries(values.pairs))

  if (Result.isFailure(decoded)) return {}

  return decoded.success
}

function lastTintMatches(last: Json, workspaceId: string, values: ThemeValues): boolean {
  const stored = jsonObject(last)

  if (stored.workspace_id !== workspaceId) return false

  const previous = jsonObject(stored.values)
  const generated = themeValuesObject(values)
  const keys = Object.keys(generated)

  if (keys.length !== Object.keys(previous).length) return false

  for (const key of keys) {
    if (previous[key] !== generated[key]) return false
  }

  return true
}

function docMatchesValues(doc: ReturnType<typeof loadDoc>, values: ThemeValues): boolean {
  for (const [key, value] of values.pairs) {
    if (!tomlEqual(doc.get(dotted(key)), value)) return false
  }

  return true
}

function mergeThemeLastWritten(state: PluginState, values: ThemeValues): void {
  const next: { [key: string]: Json } = {}
  const current = jsonObject(state.last_written)

  for (const key of Object.keys(current)) {
    const nested = current[key]

    if (nested !== undefined) next[key] = nested
  }

  for (const [key, value] of values.pairs) {
    next[key] = value
  }

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(next)

  state.last_written = Result.isSuccess(decoded) ? decoded.success : {}
}

function dropLastWritten(state: PluginState, keys: readonly string[], skip: ReadonlySet<string>): void {
  const next: { [key: string]: Json } = {}
  const current = jsonObject(state.last_written)
  const drop = new Set(keys)

  for (const key of Object.keys(current)) {
    const nested = current[key]

    if (nested === undefined) continue

    if (drop.has(key) && !skip.has(key)) continue

    next[key] = nested
  }

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(next)

  state.last_written = Result.isSuccess(decoded) ? decoded.success : {}
}

function backupKeyNames(): string[] {
  const keys = new Set<string>()

  for (const key of TINT_KEYS) keys.add(key)

  for (const key of OVERLAY_KEYS) keys.add(key)

  return [...keys].sort()
}

function workspaceLabel(workspace: JsonObject, fallback: string): string {
  const label = workspace.label

  return Predicate.isString(label) && label !== "" ? label : fallback
}

export const ensureIdentity = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
  workspaceId: string,
  workspaces: readonly WorkspaceSnapshot[] | undefined,
) {
  const live = workspaces ?? (yield* listWorkspaces()).map(workspaceFromRpc)
  const applied = tryApplyLabelRules(state, live, paths)

  if (applied.error !== undefined) {
    yield* pluginWarn(paths, output, applied.error.message)
  }

  const glyph = markerGlyph(paths)

  for (const wid of applied.changed) {
    const labelled = identityOf(state, wid)
    const colour = Predicate.isString(labelled?.colour) ? labelled.colour : undefined

    if (colour !== undefined && colour !== "") {
      yield* publishWorkspace(wid, colour, glyph)
    }
  }

  const current = identityOf(state, workspaceId)

  const existing = Predicate.isString(current?.colour) && current.colour !== ""
    ? current.colour
    : undefined

  if (existing !== undefined) {
    return {
      colour: existing,
      created: applied.changed.includes(workspaceId),
      workspaces: live,
    } satisfies IdentityEnsureResult
  }

  const assigned = allocate(state, workspaceId, live)

  state.identities[workspaceId] = { colour: assigned.colour, origin: assigned.origin }

  yield* pluginLog(
    paths,
    output,
    `assigned identity ${glyph} ${colourName(assigned.colour)} to ${workspaceId}`,
  )

  return {
    colour: assigned.colour,
    created: true,
    workspaces: live,
  } satisfies IdentityEnsureResult
})

export const setWindowTitle = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
  label: string,
  settings: PluginSettings,
) {
  if (!settings.window_title) return

  const suffix = Predicate.isString(settings.window_title_suffix) ? settings.window_title_suffix : ""
  const title = `${markerGlyph(paths)} ${label}${suffix}`
  const outcome = yield* rpcTryCall("client.window_title.set", { title })

  if (outcome.error !== undefined) {
    yield* pluginWarn(
      paths,
      output,
      `window title failed: ${outcome.error.code}: ${outcome.error.message}`,
    )

    return
  }

  state.window_title_set = true
})

export const clearWindowTitle = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
) {
  if (!state.window_title_set) return

  const outcome = yield* rpcTryCall("client.window_title.clear", {})

  if (outcome.error !== undefined) {
    yield* pluginWarn(
      paths,
      output,
      `window title clear failed: ${outcome.error.code}: ${outcome.error.message}`,
    )
  }

  state.window_title_set = false
})

export const applyTint = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
  workspaceId: string,
  force: boolean,
  workspaces: readonly WorkspaceSnapshot[] | undefined,
) {
  const settings = loadSettings(paths)
  const ensured = yield* ensureIdentity(paths, output, state, workspaceId, workspaces)
  const doc = loadDoc(paths.herdrConfigPath)
  const themeName = themeNameOf(doc)

  if (isLightTheme(themeName)) {
    yield* pluginWarn(
      paths,
      output,
      `theme ${quotedRepr(themeName ?? "")} looks light; the derived surfaces assume a dark base `
        + "(set settings.theme_base to override)",
    )
  }

  const values = generate(ensured.colour, themeName, settings)
  const managed = new Set(managedKeys(settings))

  if (lastTintMatches(state.last_tint, workspaceId, values) && docMatchesValues(doc, values)) {
    return { status: "noop", values } satisfies TintApplyResult
  }

  const conflicts = detectConflicts(doc, lastWrittenPairs(state.last_written), managed)

  if (conflicts.length > 0 && !force) {
    const details = conflicts.map((conflict) =>
      `${conflict.key} (expected ${valueRepr(conflict.expected)}, found ${valueRepr(conflict.actual)})`
    )

    yield* pluginWarn(
      paths,
      output,
      "theme keys were modified outside the plugin; not overwriting. "
        + `${details.join("; ")}. Re-run with --force to take them over.`,
    )

    return { status: "conflict", values } satisfies TintApplyResult
  }

  if (state.theme_backup === null) {
    yield* snapshotConfig(paths.herdrConfigPath, paths.stateDir)

    const unix = Math.floor((yield* Clock.currentTimeMillis) / 1000)
    const backup = captureBackup(doc, backupKeyNames(), unix)

    state.theme_backup = backupToJson(backup)

    yield* pluginLog(
      paths,
      output,
      `captured theme backup for ${Object.keys(backup.keys).length} keys`,
    )
  }

  applyValues(doc, values.pairs)

  const committed = yield* commitDoc(doc, paths.herdrConfigPath).pipe(Effect.result)

  if (Result.isFailure(committed)) {
    yield* pluginWarn(paths, output, committed.failure.message)

    return { status: "skip", values } satisfies TintApplyResult
  }

  mergeThemeLastWritten(state, values)

  state.last_tint = {
    workspace_id: workspaceId,
    values: themeValuesObject(values),
  }

  yield* reloadConfig(paths, output)

  yield* pluginLog(
    paths,
    output,
    `theme applied for ${workspaceId} (${markerGlyph(paths)} ${colourName(ensured.colour)} -> accent ${themeValue(values, "ui.accent") ?? ensured.colour})`,
  )

  return { status: "applied", values } satisfies TintApplyResult
})

export const restoreTheme = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
  doc: ReturnType<typeof loadDoc>,
  force: boolean,
) {
  const backup = backupFromJson(state.theme_backup)

  if (backup === undefined) {
    const empty: ThemeRestoreResult = { restored: [], skipped: [] }

    return empty
  }

  const managed = new Set(Object.keys(backup.keys))
  const conflicts = detectConflicts(doc, lastWrittenPairs(state.last_written), managed)
  const skip = new Set<string>()

  if (conflicts.length > 0 && !force) {
    for (const conflict of conflicts) {
      yield* pluginWarn(
        paths,
        output,
        `${conflict.key} changed outside the plugin (plugin wrote ${valueRepr(conflict.expected)}, found ${valueRepr(conflict.actual)}); `
          + "leaving it alone -- use --force to restore anyway",
      )
      skip.add(conflict.key)
    }
  }

  const restored = restoreBackup(doc, backup, [["theme", "custom"]], skip)
  const skipped = [...skip].sort()

  return { restored, skipped } satisfies ThemeRestoreResult
})

export const reapplyEverything = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
) {
  const workspaces = (yield* listWorkspaces()).map(workspaceFromRpc)

  yield* reconcileMetadata(paths, output, state, workspaces, undefined, true)

  if (!state.tint_enabled) return "metadata-only"

  const focused = yield* focusedWorkspace()

  if (focused === undefined) return "metadata-only"

  const workspaceId = Predicate.isString(focused.workspace_id) ? focused.workspace_id : undefined

  if (workspaceId === undefined || workspaceId === "") return "metadata-only"

  state.last_tint = null

  const result = yield* applyTint(paths, output, state, workspaceId, false, workspaces)

  if (result.status === "applied" || result.status === "noop") {
    yield* setWindowTitle(
      paths,
      output,
      state,
      workspaceLabel(focused, workspaceId),
      loadSettings(paths),
    )
  }

  return result.status
})

export const runTintEnable = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const force = argv.includes("--force")

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    tintEnableLocked(paths, output, force),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "tint-enable: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const tintEnableLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  force: boolean,
) {
  const state = load(statePath(paths.stateDir))

  state.tint_enabled = true

  const focused = yield* focusedWorkspace()

  if (focused === undefined) {
    save(statePath(paths.stateDir), state)
    output.stdout.push("tint enabled (no focused workspace yet)")

    return 0
  }

  const workspaceId = Predicate.isString(focused.workspace_id) ? focused.workspace_id : undefined

  if (workspaceId === undefined || workspaceId === "") {
    save(statePath(paths.stateDir), state)
    output.stdout.push("tint enabled (no focused workspace yet)")

    return 0
  }

  const result = yield* applyTint(paths, output, state, workspaceId, force, undefined)

  if (result.status === "applied" || result.status === "noop") {
    yield* setWindowTitle(
      paths,
      output,
      state,
      workspaceLabel(focused, workspaceId),
      loadSettings(paths),
    )
  }

  save(statePath(paths.stateDir), state)
  output.stdout.push(`tint enabled; ${result.status} for ${workspaceId}`)

  return result.status === "skip" ? 1 : 0
})

export const runTintDisable = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const force = argv.includes("--force")

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    tintDisableLocked(paths, output, force),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "tint-disable: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const tintDisableLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  force: boolean,
) {
  const state = load(statePath(paths.stateDir))

  state.tint_enabled = false

  const doc = loadDoc(paths.herdrConfigPath)
  const restored = yield* restoreTheme(paths, output, state, doc, force)

  if (restored.restored.length > 0) {
    const committed = yield* commitDoc(doc, paths.herdrConfigPath).pipe(Effect.result)

    if (Result.isFailure(committed)) {
      yield* pluginWarn(paths, output, committed.failure.message)
      save(statePath(paths.stateDir), state)

      return 1
    }

    const backup = backupFromJson(state.theme_backup)
    const keys = backup === undefined ? [] : Object.keys(backup.keys)
    const skip = new Set(restored.skipped)

    dropLastWritten(state, keys, skip)
    state.theme_backup = null
    state.last_tint = null

    yield* reloadConfig(paths, output)

    yield* pluginLog(paths, output, `theme restored (${restored.restored.length} keys)`)
  }

  yield* clearWindowTitle(paths, output, state)
  save(statePath(paths.stateDir), state)

  const skippedNote = restored.skipped.length > 0 ? `, skipped ${restored.skipped.length}` : ""

  output.stdout.push(`tint disabled; restored ${restored.restored.length} keys${skippedNote}`)

  return 0
})

export const runThemeRestore = runTintDisable

type IntensityLockResult = {
  readonly code: number
  readonly status: string
}

export const printPreview = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  settings: PluginSettings,
) {
  const state = load(statePath(paths.stateDir))
  const focused = yield* focusedWorkspace()

  if (focused === undefined) return

  const workspaceId = Predicate.isString(focused.workspace_id) ? focused.workspace_id : undefined

  if (workspaceId === undefined || workspaceId === "") return

  const info = identityOf(state, workspaceId)
  const colour = Predicate.isString(info?.colour) ? info.colour : undefined

  if (colour === undefined || colour === "") return

  const doc = loadDoc(paths.herdrConfigPath)
  const themeName = themeNameOf(doc)
  const base = resolveBase(themeName, settings)

  const order = [
    "theme.custom.panel_bg",
    "theme.custom.surface_dim",
    "theme.custom.surface0",
    "theme.custom.surface1",
    "theme.custom.overlay0",
    "theme.custom.overlay1",
  ]

  const ranked = [...INTENSITY_NAMES].sort((left, right) =>
    intensityPreset(left).surface1 - intensityPreset(right).surface1
  )

  output.stdout.push(
    `\n${workspaceLabel(focused, workspaceId)}  ${colourName(colour)}   base ${base} ${swatch(base, 4)}`,
  )

  for (const name of ranked) {
    const trial = structuredClone(settings)

    trial.intensity = name
    trial.blend = {}

    const vals = generate(colour, themeName, trial)
    let cells = ""

    for (const key of order) {
      const hex = themeValue(vals, key)

      if (hex === undefined) continue

      cells += `${swatch(hex, 5)} `
    }

    const mark = name === intensityName(settings) ? "*" : " "

    output.stdout.push(` ${mark} ${name.padEnd(7)} ${cells}`)
  }

  output.stdout.push(`   ${"".padEnd(7)} ${swatch(colour, 5)} accent`)
  output.stdout.push("   panel_bg surf_dim surface0 surface1 overlay0 overlay1   (* = active)")
})

export const runPreview = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  yield* printPreview(paths, output, loadSettings(paths))

  return commandResult(0, output)
})

export const runIntensity = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const args = argv.filter((arg) => !arg.startsWith("-"))

  if (args.length === 0) {
    const settings = loadSettings(paths)

    output.stdout.push(
      `intensity: ${intensityName(settings)} (overlays ${resolveOverlays(settings) ? "on" : "off"})`,
    )
    output.stdout.push(`choose one of: ${INTENSITY_NAMES.join(", ")}`)

    return commandResult(0, output)
  }

  const name = (args[0] ?? "").trim().toLowerCase()

  if (name !== "subtle" && name !== "medium" && name !== "bold") {
    yield* pluginWarn(
      paths,
      output,
      `unknown intensity ${quotedRepr(name)}; choose one of: ${INTENSITY_NAMES.join(", ")}`,
    )

    return commandResult(1, output)
  }

  const locked = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    intensityLocked(paths, output, name),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "intensity: timed out waiting for plugin lock").pipe(
        Effect.as({ code: 1, status: "" } satisfies IntensityLockResult),
      )
    ),
  )

  if (locked.code !== 0) return commandResult(locked.code, output)

  const settings = loadSettings(paths)

  output.stdout.push(
    `intensity: ${name} (border/separator tint ${resolveOverlays(settings) ? "on" : "off"}) -> ${locked.status}`,
  )

  yield* printPreview(paths, output, settings)

  return commandResult(0, output)
})

const intensityLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  name: IntensityName,
) {
  saveSettings(paths, { intensity: name })

  const state = load(statePath(paths.stateDir))
  const status = yield* reapplyEverything(paths, output, state)

  save(statePath(paths.stateDir), state)

  return { code: 0, status } satisfies IntensityLockResult
})
