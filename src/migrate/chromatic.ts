import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { Predicate, Result, Schema } from "effect"

import { MigrationError } from "../runtime/errors.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { loadSettings, settingsPath } from "../runtime/settings.ts"
import { rulesPath } from "../spaces/labels.ts"
import { resolveColour } from "../spaces/identity.ts"
import type { PluginState } from "../state/store.ts"
import { copyExact } from "./files.ts"
import { isTruthyJson, toJsonObject, type JsonObject } from "./json.ts"
import { readJsonObject } from "./read-json.ts"

type Json = typeof Schema.Json.Type

export type ChromaticReport = {
  chromatic_state_dir: string
  chromatic_config_dir: string
  layouts_state_dir: string
  identities_imported: string[]
  settings_copied: boolean
  layouts_settings_copied: boolean
  label_rules_copied: boolean
  ignored_stale_backups: string[]
  notes: string[]
  dry_run: boolean
}

type IdentityRecord = {
  readonly colour: string
  readonly origin: string
}

function asObject(value: Json | undefined): JsonObject | undefined {
  if (value === undefined || value === null) return undefined

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function normaliseIdentities(raw: Json | undefined): ReadonlyArray<readonly [string, IdentityRecord]> {
  const incoming = asObject(raw) ?? {}
  const out: Array<readonly [string, IdentityRecord]> = []

  for (const wid of Object.keys(incoming)) {
    if (wid === "") continue

    const info = asObject(incoming[wid])

    if (info === undefined) continue

    const colourValue = info.colour
    const colourText = Predicate.isString(colourValue) ? colourValue : ""
    const colour = resolveColour(colourText)

    if (colour === undefined) continue

    const originValue = info.origin
    let origin = Predicate.isString(originValue) && originValue !== "" ? originValue : "auto"

    if (origin !== "auto" && origin !== "manual" && origin !== "label") origin = "auto"

    out.push([wid, { colour, origin }])
  }

  return out
}

function identityConflicts(
  current: PluginState["identities"],
  incoming: ReadonlyArray<readonly [string, IdentityRecord]>,
): Array<readonly [string, Json | undefined, string]> {
  const conflicts: Array<readonly [string, Json | undefined, string]> = []
  const sorted = [...incoming].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)

  for (const [wid, want] of sorted) {
    const have = asObject(current[wid])

    if (have !== undefined && have.colour !== want.colour) {
      conflicts.push([wid, have.colour, want.colour])
    }
  }

  return conflicts
}

export function importLegacy(
  paths: PluginPathValues,
  state: PluginState,
  force: boolean,
  dryRun: boolean,
): ChromaticReport {
  const report: ChromaticReport = {
    chromatic_state_dir: paths.chromaticStateDir,
    chromatic_config_dir: paths.chromaticConfigDir,
    layouts_state_dir: paths.layoutsStateDir,
    identities_imported: [],
    settings_copied: false,
    layouts_settings_copied: false,
    label_rules_copied: false,
    ignored_stale_backups: [],
    notes: [],
    dry_run: dryRun,
  }

  const oldPath = join(paths.chromaticStateDir, "state.json")
  const old = readJsonObject(oldPath)

  if (old === undefined) {
    report.notes.push(`no Chromatic state.json at ${oldPath}`)
  } else {
    if (isTruthyJson(old.sidebar_backup)) report.ignored_stale_backups.push("sidebar_backup")

    if (isTruthyJson(old.theme_backup)) report.ignored_stale_backups.push("theme_backup")

    if (isTruthyJson(old.last_written)) report.ignored_stale_backups.push("last_written")

    report.notes.push(
      `retained Chromatic state at ${oldPath} for rollback; not applied as config backup`,
    )

    const incoming = normaliseIdentities(old.identities)
    const conflicts = identityConflicts(state.identities, incoming)

    if (conflicts.length > 0 && !force) {
      const detail = conflicts
        .map(([wid, have, want]) => `${wid}: have ${String(have)}, chromatic ${want}`)
        .join("; ")

      throw new MigrationError({
        message: `identity conflicts with Chromatic state (pass --force to overlay): ${detail}`,
      })
    }

    for (const [wid, info] of incoming) {
      report.identities_imported.push(wid)

      if (dryRun) continue

      state.identities[wid] = { colour: info.colour, origin: info.origin }
    }

    if (old.alloc_cursor !== undefined && old.alloc_cursor !== null && (force || state.alloc_cursor === 0)) {
      if (!dryRun) state.alloc_cursor = Math.trunc(Number(old.alloc_cursor) || 0)
    }

    if ((old.view_mode === "all" || old.view_mode === "current") && !state.view_installed) {
      if (!dryRun) state.view_mode = old.view_mode
    }

    if (old.tint_enabled && !state.tint_enabled) {
      report.notes.push(
        "Chromatic tint was enabled; not auto-enabling. Run tint-enable after cutover.",
      )
    }
  }

  const oldSettings = join(paths.chromaticConfigDir, "settings.json")
  const newSettings = settingsPath(paths)

  if (existsSync(oldSettings) && !existsSync(newSettings)) {
    report.settings_copied = true

    if (!dryRun) {
      copyExact(oldSettings, newSettings)
      report.notes.push("copied Chromatic settings.json (new file only)")
    }
  } else if (existsSync(oldSettings) && existsSync(newSettings)) {
    report.notes.push("kept existing plugin settings.json; Chromatic settings left in place")
  }

  const layoutsSettings = join(paths.layoutsConfigDir, "settings.json")
  const destLayouts = join(paths.configDir, "legacy-layouts-settings.json")

  if (existsSync(layoutsSettings)) {
    report.layouts_settings_copied = true

    if (!dryRun && !existsSync(destLayouts)) {
      copyExact(layoutsSettings, destLayouts)
      report.notes.push("copied layouts settings to legacy-layouts-settings.json")
    }
  }

  const srcRules = rulesPath(paths, loadSettings(paths), process.env.HERDR_LABEL_IDENTITIES_FILE)
  const destRules = join(paths.configDir, "identities.json")

  if (existsSync(srcRules) && resolve(srcRules) !== resolve(destRules)) {
    if (!existsSync(destRules)) {
      report.label_rules_copied = true

      if (!dryRun) {
        copyExact(srcRules, destRules)
        report.notes.push(`copied label identities from ${srcRules}`)
      }
    } else {
      report.notes.push("kept existing identities.json; source rules left in place")
    }
  }

  return report
}

export function chromaticReportJson(report: ChromaticReport): JsonObject {
  return toJsonObject({
    chromatic_state_dir: report.chromatic_state_dir,
    chromatic_config_dir: report.chromatic_config_dir,
    layouts_state_dir: report.layouts_state_dir,
    identities_imported: report.identities_imported,
    settings_copied: report.settings_copied,
    layouts_settings_copied: report.layouts_settings_copied,
    label_rules_copied: report.label_rules_copied,
    ignored_stale_backups: report.ignored_stale_backups,
    notes: report.notes,
    dry_run: report.dry_run,
  })
}
