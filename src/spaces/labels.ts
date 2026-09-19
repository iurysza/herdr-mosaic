import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { Predicate, Result, Schema } from "effect"

import { LabelRulesError } from "../runtime/errors.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { loadSettings, settingsString, type PluginSettings } from "../runtime/settings.ts"
import { setIdentity, type PluginState, identityOf } from "../state/store.ts"
import { resolveColour, type WorkspaceSnapshot } from "./identity.ts"

type Json = typeof Schema.Json.Type

export type LabelRuleSet = ReadonlyArray<readonly [string, string]>

export type InvalidInlineRule = {
  readonly label: string
  readonly colour: Json
}

export type LabelApplyOutcome = {
  readonly changed: string[]
  readonly error?: LabelRulesError
}

export function rulesPath(
  paths: PluginPathValues,
  settings: PluginSettings,
  envFile?: string,
): string {
  if (envFile !== undefined && envFile !== "") return envFile

  const configured = settingsString(settings, "label_identities_file")

  if (configured !== undefined) return configured

  const pluginPath = join(paths.configDir, "identities.json")

  if (existsSync(pluginPath)) return pluginPath

  const legacy = join(dirname(paths.herdrConfigPath), "chromatic-spaces-identities.json")

  if (existsSync(legacy)) return legacy

  return pluginPath
}

export function parseLabelFile(data: Json, path: string): LabelRuleSet {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(data)

  if (Result.isFailure(decoded) || decoded.success.version !== 1) {
    throw new LabelRulesError({
      message: `label identities ${path} must be version 1 with an identities object`,
    })
  }

  const raw = Schema.decodeUnknownResult(Schema.JsonObject)(decoded.success.identities ?? null)

  if (Result.isFailure(raw)) {
    throw new LabelRulesError({
      message: `label identities ${path} missing identities object`,
    })
  }

  const out: Array<readonly [string, string]> = []

  for (const label of Object.keys(raw.success)) {
    const colour = raw.success[label]

    if (label === "" || !Predicate.isString(colour) || colour === "") {
      throw new LabelRulesError({
        message: `invalid label identity entry in ${path}`,
      })
    }

    const resolved = resolveColour(colour)

    if (resolved === undefined) {
      throw new LabelRulesError({
        message: `label ${JSON.stringify(label)} colour ${JSON.stringify(colour)} is not a palette name or #rrggbb`,
      })
    }

    out.push([label, resolved])
  }

  return out
}

function loadFile(path: string): LabelRuleSet {
  if (path === "" || !existsSync(path)) return []

  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)

    throw new LabelRulesError({
      message: `unreadable label identities file ${path}: ${detail}`,
    })
  }

  const json = Schema.decodeUnknownResult(Schema.Json)(parsed)

  if (Result.isFailure(json)) {
    throw new LabelRulesError({
      message: `unreadable label identities file ${path}: not JSON`,
    })
  }

  return parseLabelFile(json.success, path)
}

function overlayInline(
  rules: Map<string, string>,
  inline: Json,
  onInvalid: (entry: InvalidInlineRule) => void,
): void {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(inline)

  if (Result.isFailure(decoded)) {
    throw new LabelRulesError({
      message: "settings.label_identities must be an object",
    })
  }

  for (const label of Object.keys(decoded.success)) {
    if (label === "") continue

    const colour = decoded.success[label]
    const resolved = Predicate.isString(colour) ? resolveColour(colour) : undefined

    if (resolved === undefined) {
      onInvalid({ label, colour: colour ?? null })
      continue
    }

    rules.set(label, resolved)
  }
}

export function loadRules(
  paths: PluginPathValues,
  settings: PluginSettings = loadSettings(paths),
  envFile = process.env.HERDR_LABEL_IDENTITIES_FILE,
): LabelRuleSet {
  const rules = new Map(loadFile(rulesPath(paths, settings, envFile)))
  const inline = settings.label_identities ?? {}

  overlayInline(rules, inline, () => {
    // caller logs invalid overlay entries
  })

  return [...rules.entries()]
}

export function loadRulesWithWarn(
  paths: PluginPathValues,
  onInvalidInline: (entry: InvalidInlineRule) => void,
  settings: PluginSettings = loadSettings(paths),
  envFile = process.env.HERDR_LABEL_IDENTITIES_FILE,
): LabelRuleSet {
  const rules = new Map(loadFile(rulesPath(paths, settings, envFile)))

  overlayInline(rules, settings.label_identities ?? {}, onInvalidInline)

  return [...rules.entries()]
}

export function applyLabelRules(
  state: PluginState,
  workspaces: readonly WorkspaceSnapshot[],
  rules: LabelRuleSet,
): string[] {
  if (rules.length === 0) return []

  const byLabel = new Map(rules)
  const changed: string[] = []

  for (const workspace of workspaces) {
    const wid = workspace.workspace_id
    const label = workspace.label

    if (wid === undefined || wid === "" || label === undefined || label === "") continue

    const colour = byLabel.get(label)

    if (colour === undefined) continue

    const current = identityOf(state, wid) ?? {}

    if (current.origin === "manual") continue

    if (current.colour === colour && current.origin === "label") continue

    setIdentity(state, wid, colour, "label")
    changed.push(wid)
  }

  return changed
}

export function tryApplyLabelRules(
  state: PluginState,
  workspaces: readonly WorkspaceSnapshot[],
  paths: PluginPathValues,
): LabelApplyOutcome {
  try {
    const changed = applyLabelRules(state, workspaces, loadRules(paths))

    return { changed } satisfies LabelApplyOutcome
  } catch (cause) {
    if (cause instanceof LabelRulesError) {
      return { changed: [], error: cause } satisfies LabelApplyOutcome
    }

    throw cause
  }
}
