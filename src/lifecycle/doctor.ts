import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { Effect, Predicate, Result, Schema } from "effect"

import { normalizeScope, normalizeSort } from "../agents/view.ts"
import {
  IDLE_NEXT_COMMAND,
  IDLE_OLDEST_COMMAND,
  NATIVE_NAV_BINDINGS,
  PICKER_COMMAND,
  SORT_TOGGLE_COMMAND,
} from "../config/keybinds.ts"
import {
  agentRowTokenCount,
  detectConflicts,
  hasAgentTemplate,
  hasDots,
  keybindKey,
  loadDoc,
  nativeKeyValue,
  sidebarTargets,
  tokenName,
  validate,
} from "../config/patch.ts"
import { lastWrittenPairs } from "../config/sidebar.ts"
import {
  isMissing,
  isTomlList,
  isTomlString,
  type TomlValue,
} from "../config/toml-edit.ts"
import { ELAPSED_TTL_MS, MAX_TOKENS_PER_ROW, PLUGIN_ID, PLUGIN_VERSION } from "../ids.ts"
import {
  emptyOutput,
  joinOutput,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { rpcTryCall, type JsonObject } from "../runtime/rpc.ts"
import { loadSettings, settingsPath } from "../runtime/settings.ts"
import { readSocketGeneration, workerHeartbeatPath } from "../runtime/worker.ts"
import { identityOf, load } from "../state/store.ts"
import { allSlotTokens, closePairs, slotForColour } from "../spaces/identity.ts"
import { markerGlyph } from "../spaces/metadata.ts"
import {
  generate,
  intensityName,
  resolveBase,
  resolveOverlays,
  themeValue,
} from "../spaces/theme.ts"

type Json = typeof Schema.Json.Type

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

function doctorRow(key: string, value: string): string {
  return `  ${`${key}:`.padEnd(30)} ${value}`
}

function jsonObject(value: Json | undefined): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isSuccess(decoded)) return decoded.success

  return {}
}

function jsonList(value: Json | undefined): readonly Json[] {
  return Array.isArray(value) ? value : []
}

function rpcErrorText(error: { readonly code: string; readonly message: string }): string {
  return `${error.code}: ${error.message}`
}

function themeNameOf(doc: ReturnType<typeof loadDoc>): string | undefined {
  const value = doc.get(["theme", "name"])

  if (isMissing(value) || !isTomlString(value)) return undefined

  return value
}

function tokenNames(rows: TomlValue): string[] {
  const names: string[] = []

  if (!isTomlList(rows)) return names

  for (const row of rows) {
    const entries = isTomlList(row) ? row : []

    for (const entry of entries) {
      const name = tokenName(entry)

      if (name !== undefined && name !== "") names.push(name)
    }
  }

  return names
}

function backupKeyCount(value: Json): number | undefined {
  if (value === null) return undefined

  const object = jsonObject(value)
  const keys = jsonObject(object.keys)

  return Object.keys(keys).length
}

function refreshAgeSeconds(paths: PluginPathValues): number | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(workerHeartbeatPath(paths.stateDir, readSocketGeneration(paths.socketPath)), "utf8"),
    )

    const object = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

    if (Result.isFailure(object)) return undefined

    const published = object.success.published_at

    if (!Predicate.isNumber(published)) return undefined

    return Date.now() / 1000 - published
  } catch {
    return undefined
  }
}

type RunningSession = {
  readonly name: string
}

function runningSessions(herdrBin: string): RunningSession[] {
  try {
    const proc = spawnSync(herdrBin, ["session", "list", "--json"], {
      encoding: "utf8",
      timeout: 10_000,
    })

    const parsed: unknown = JSON.parse(proc.stdout ?? "")
    const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(parsed)

    if (Result.isFailure(decoded)) return []

    const out: RunningSession[] = []

    for (const item of jsonList(decoded.success.sessions)) {
      const session = jsonObject(item)

      if (session.running !== true) continue

      const name = session.name

      if (Predicate.isString(name)) out.push({ name })
    }

    return out
  } catch {
    return []
  }
}

function noneRepr(value: Json | undefined): string {
  if (value === undefined || value === null) return "None"

  if (Predicate.isString(value)) return value

  return String(value)
}

export const runDoctor = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const state = load(statePath(paths.stateDir))
  const settings = loadSettings(paths)
  const problems: string[] = []
  const lines: string[] = []

  lines.push("iurysza.mosaic doctor")
  lines.push("")

  const ping = yield* rpcTryCall("ping", {})
  let pingFailed = false
  let pong: JsonObject = {}

  if (ping.error !== undefined) {
    pingFailed = true
    lines.push(doctorRow("herdr server", `UNREACHABLE (${rpcErrorText(ping.error)})`))
    problems.push(
      `Herdr server not reachable on ${paths.socketPath} -- is Herdr running? `
        + "Start it with `herdr`.",
    )
  } else if (ping.result !== undefined) {
    pong = ping.result
  }

  const version = pong.version
  const protocol = pong.protocol
  const versionText = version === undefined ? "?" : String(version)
  const protocolText = protocol === undefined ? "?" : String(protocol)

  lines.push(doctorRow("herdr version", `${versionText} (protocol ${protocolText})`))
  lines.push(doctorRow("plugin version", PLUGIN_VERSION))
  lines.push(doctorRow("plugin id", PLUGIN_ID))
  lines.push(doctorRow(
    "config path",
    `${paths.herdrConfigPath}${existsSync(paths.herdrConfigPath) ? "" : " (MISSING)"}`,
  ))
  lines.push(doctorRow("plugin config dir", paths.configDir))
  lines.push(doctorRow("plugin state dir", paths.stateDir))
  lines.push(doctorRow(
    "settings file",
    `${settingsPath(paths)}${existsSync(settingsPath(paths)) ? "" : " (defaults)"}`,
  ))

  const doc = loadDoc(paths.herdrConfigPath)
  const themeName = themeNameOf(doc)

  lines.push(doctorRow("base theme", themeName ?? "(herdr default)"))
  lines.push(doctorRow("blend base", resolveBase(themeName, settings)))

  if (doc.get(["theme", "auto_switch"]) === true) {
    problems.push(
      "theme.auto_switch is true: Herdr may swap the base theme "
        + "under the plugin's derived surfaces. Consider setting it "
        + "false while using the tint.",
    )
  }

  let workspaces: JsonObject[] = []
  let agents: JsonObject[] = []

  if (!pingFailed) {
    const listedWs = yield* rpcTryCall("workspace.list", {})
    const listedAgents = yield* rpcTryCall("agent.list", {})

    for (const item of jsonList(listedWs.result === undefined ? undefined : listedWs.result.workspaces)) {
      const object = Schema.decodeUnknownResult(Schema.JsonObject)(item)

      if (Result.isSuccess(object)) workspaces.push(object.success)
    }

    for (const item of jsonList(listedAgents.result === undefined ? undefined : listedAgents.result.agents)) {
      const object = Schema.decodeUnknownResult(Schema.JsonObject)(item)

      if (Result.isSuccess(object)) agents.push(object.success)
    }
  }

  let focused: JsonObject | undefined

  for (const workspace of workspaces) {
    if (workspace.focused === true) focused = workspace
  }

  lines.push(doctorRow("workspaces", String(workspaces.length)))
  lines.push(doctorRow("agents", String(agents.length)))

  if (focused !== undefined) {
    const fid = focused.workspace_id
    const id = Predicate.isString(fid) ? fid : "None"
    const info = Predicate.isString(fid) ? identityOf(state, fid) : undefined

    lines.push(doctorRow("focused workspace", `${id} (${noneRepr(focused.label)})`))

    if (info === undefined) {
      lines.push(doctorRow("focused identity", "NONE ASSIGNED"))
      problems.push(
        `Focused workspace ${id} has no identity. Run the `
          + "'Mosaic: Assign missing space colors' action.",
      )
    } else {
      const colourValue = info.colour
      const colour = Predicate.isString(colourValue) ? colourValue : "None"

      lines.push(doctorRow(
        "focused identity",
        `${markerGlyph(paths)} ${colour}  slot=${slotForColour(Predicate.isString(colourValue) ? colourValue : "")} (${noneRepr(info.origin)})`,
      ))
    }
  } else {
    lines.push(doctorRow("focused workspace", "(none)"))
  }

  const snapshots: Array<{
    readonly workspace_id?: string
    readonly focused?: boolean
    readonly label?: string
  }> = []

  for (const workspace of workspaces) {
    snapshots.push({
      workspace_id: Predicate.isString(workspace.workspace_id) ? workspace.workspace_id : undefined,
      focused: workspace.focused === true,
      label: Predicate.isString(workspace.label) ? workspace.label : undefined,
    })
  }

  const close = snapshots.length > 0 ? closePairs(state, snapshots) : []

  if (close.length > 0) {
    const parts: string[] = []

    for (const pair of close) {
      parts.push(`${pair[0]}/${pair[1]} (${pair[2].toFixed(0)} apart)`)
    }

    problems.push(
      `Space colours that may be hard to tell apart: ${parts.join("; ")}. `
        + "Run 'repalette', or set one explicitly with prefix+i.",
    )
  }

  const identities = state.identities
  const storedIds = Object.keys(identities)

  lines.push(doctorRow("identities stored", String(storedIds.length)))

  const known = new Set<string>()

  for (const workspace of workspaces) {
    if (Predicate.isString(workspace.workspace_id)) known.add(workspace.workspace_id)
  }

  const missing: string[] = []

  for (const id of known) {
    if (identities[id] === undefined) missing.push(id)
  }

  missing.sort()

  if (missing.length > 0) {
    problems.push(
      `Workspaces without an identity: ${missing.join(", ")}. Run `
        + "'Mosaic: Assign missing space colors'.",
    )
  }

  const slotTokens = allSlotTokens()
  let published = 0

  for (const workspace of workspaces) {
    const tokens = jsonObject(workspace.tokens)
    let any = false

    for (const token of slotTokens) {
      if (tokens[token]) any = true
    }

    if (any) published += 1
  }

  lines.push(doctorRow("workspace metadata", `${published}/${workspaces.length} published`))

  if (workspaces.length > 0 && published < workspaces.length) {
    problems.push(
      `Only ${published} of ${workspaces.length} workspaces carry a space dot. `
        + "Metadata is dropped on server restart -- run the "
        + "`mosaic reconcile` recovery command.",
    )
  }

  let panePublished = 0

  for (const agent of agents) {
    const paneId = agent.pane_id

    if (!Predicate.isString(paneId)) continue

    const paneResult = yield* rpcTryCall("pane.get", jsonObject({ pane_id: paneId }))

    if (paneResult.error !== undefined) continue

    const pane = jsonObject(jsonObject(paneResult.result).pane)
    const tokens = jsonObject(pane.tokens)
    let any = false

    for (const token of slotTokens) {
      if (tokens[token]) any = true
    }

    if (any) panePublished += 1
  }

  lines.push(doctorRow("agent pane metadata", `${panePublished}/${agents.length} published`))
  lines.push(doctorRow("sidebar tokens installed", state.sidebar_installed ? "yes" : "no"))

  for (const [path, _defaultRows, label] of sidebarTargets(doc)) {
    const cur = doc.get(path)

    if (isMissing(cur)) {
      lines.push(doctorRow(`  ${label}`, "(not set)"))
      continue
    }

    const names = tokenNames(cur)

    if (label === "ui.sidebar.agents.rows") {
      const count = agentRowTokenCount(cur)
      let status = "NOT PLUGIN TEMPLATE"

      if (hasDots(cur)) {
        status = "HAS SPACE DOTS (bad)"
        problems.push(
          "Agents row still has $sd_* tokens. Re-run install; do not "
            + "add space dots to the 15-token title row (Herdr max 16).",
        )
      } else if (hasAgentTemplate(cur)) {
        status = `OK ${count} tokens`
      } else {
        problems.push(
          "Agents row is not the elapsed/title/tier template. Run install.",
        )
      }

      if (count > MAX_TOKENS_PER_ROW) {
        problems.push(`Agents row has ${count} tokens; Herdr max is ${MAX_TOKENS_PER_ROW}.`)
      }

      lines.push(doctorRow(`  ${label}`, `${status}  ${names.join(" ")}`))
    } else if (label.startsWith("ui.sidebar.agents.rows_by_agent.")) {
      lines.push(doctorRow(`  ${label}`, `preserved  ${names.join(" ")}`))
      problems.push(
        `${label} fully replaces ui.sidebar.agents.rows for that agent, so it `
          + "will not show the elapsed/title/tier template. This plugin does "
          + "not rewrite rows_by_agent.",
      )
    } else {
      lines.push(doctorRow(
        `  ${label}`,
        `${hasDots(cur) ? "OK" : "NO DOT"}  ${names.join(" ")}`,
      ))
    }
  }

  const bound = keybindKey(doc, PICKER_COMMAND)
  const sortBound = keybindKey(doc, SORT_TOGGLE_COMMAND)
  const idleBound = keybindKey(doc, IDLE_NEXT_COMMAND)
  const oldestBound = keybindKey(doc, IDLE_OLDEST_COMMAND)

  lines.push(doctorRow(
    "picker keybinding",
    bound === undefined ? "not bound (run keybind-install)" : bound,
  ))
  lines.push(doctorRow(
    "sort keybinding",
    sortBound === undefined ? "not bound (run sort-keybind-install)" : sortBound,
  ))
  lines.push(doctorRow(
    "newest agent keybinding",
    idleBound === undefined ? "not bound (run idle-keybind-install)" : idleBound,
  ))
  lines.push(doctorRow(
    "oldest agent keybinding",
    oldestBound === undefined ? "not bound (run oldest-idle-keybind-install)" : oldestBound,
  ))

  for (const binding of NATIVE_NAV_BINDINGS) {
    const chord = nativeKeyValue(doc, binding.action)

    lines.push(doctorRow(
      binding.action,
      chord === undefined || chord === "" ? "not bound (run navigation-keybind-install)" : chord,
    ))
  }

  lines.push(doctorRow("agent view owned", state.view_installed ? "yes" : "no"))
  lines.push(doctorRow(
    "agent focus",
    state.view_installed ? normalizeScope(state.view_mode) : "(none)",
  ))
  lines.push(doctorRow(
    "agent sort",
    state.view_installed ? normalizeSort(state.sort_mode) : "(none)",
  ))

  if (state.view_installed) {
    lines.push(doctorRow("native sort button", "disabled while Mosaic's view is active"))
  }

  lines.push(doctorRow("agent view readback", "unavailable -- herdr 0.8.2 has no agent.view.get"))
  lines.push(doctorRow("tint enabled", state.tint_enabled ? "yes" : "no"))
  lines.push(doctorRow("intensity", intensityName(settings)))
  lines.push(doctorRow("tint overlays", resolveOverlays(settings) ? "yes" : "no"))
  lines.push(doctorRow("marker", quotedRepr(markerGlyph(paths))))
  lines.push(doctorRow("space-change toast", settings.announce ? "on" : "off"))

  const lastTint = jsonObject(state.last_tint)
  const lastWorkspace = lastTint.workspace_id

  lines.push(doctorRow(
    "last tinted workspace",
    Predicate.isString(lastWorkspace) && lastWorkspace !== "" ? lastWorkspace : "(none)",
  ))

  if (focused !== undefined && state.tint_enabled) {
    const fid = focused.workspace_id
    const info = Predicate.isString(fid) ? identityOf(state, fid) : undefined
    const colour = info === undefined ? undefined : info.colour

    if (Predicate.isString(colour) && colour !== "") {
      const values = generate(colour, themeName, settings)
      const keys: string[] = []

      for (const [key] of values.pairs) keys.push(key)

      keys.sort()
      lines.push("  generated theme values:")

      for (const key of keys) {
        const wanted = themeValue(values, key) ?? ""
        const actual = doc.get(key.split("."))
        const mark = !isMissing(actual) && actual === wanted ? "OK " : "DIFF"

        lines.push(
          `    ${mark} ${key.padEnd(28)} ${wanted} (config: ${isMissing(actual) ? "absent" : String(actual)})`,
        )
      }
    }
  }

  const themeKeys = backupKeyCount(state.theme_backup)

  lines.push(doctorRow(
    "theme backup",
    themeKeys === undefined ? "none" : `captured (${themeKeys} keys)`,
  ))

  const conflicts = detectConflicts(doc, lastWrittenPairs(state.last_written))

  lines.push(doctorRow("config conflicts", String(conflicts.length)))

  for (const conflict of conflicts) {
    const found = conflict.actual === undefined ? "None" : JSON.stringify(conflict.actual)

    lines.push(`    ${conflict.key}: plugin wrote ${JSON.stringify(conflict.expected)}, config has ${found}`)
  }

  if (conflicts.length > 0) {
    problems.push(
      `${conflicts.length} config key(s) changed outside the plugin. The plugin `
        + "will not overwrite them; pass --force to a tint/restore "
        + "action to take them over, or leave them as yours.",
    )
  }

  const age = refreshAgeSeconds(paths)

  lines.push(doctorRow(
    "sidebar refresh",
    age === undefined ? "not running" : `last round ${age.toFixed(1)}s ago`,
  ))

  if (state.sidebar_installed && (age === undefined || age > ELAPSED_TTL_MS / 1000)) {
    problems.push(
      "Mosaic sidebar refresh is missing or stale. Run reconcile "
        + "and inspect refresh.log in the plugin state directory.",
    )
  }

  const sessions = runningSessions(paths.herdrBin)
  const sessionNames: string[] = []

  for (const session of sessions) sessionNames.push(session.name)

  lines.push(doctorRow("herdr sessions running", `${sessions.length} (${sessionNames.join(", ")})`))

  if (sessions.length > 1) {
    problems.push(
      "More than one Herdr session is running. config.toml is "
        + "GLOBAL across sessions (there is no per-session config), "
        + "so each session's workspace.focused hook writes the same "
        + "theme keys and they will fight. Use the dynamic tint with "
        + "a single active session.",
    )
  }

  const checked = yield* validate(doc.dumps())

  lines.push(doctorRow(
    "config validates",
    checked.ok ? "yes" : `NO -- ${checked.output}`,
  ))

  if (!checked.ok) {
    problems.push(`Current config does not pass \`herdr config check\`: ${checked.output}`)
  }

  lines.push("")

  if (problems.length > 0) {
    lines.push(`Problems (${problems.length}):`)

    for (let i = 0; i < problems.length; i++) {
      lines.push(`  ${i + 1}. ${problems[i]}`)
    }
  } else {
    lines.push("No problems found.")
  }

  for (const line of lines) output.stdout.push(line)

  return commandResult(0, output)
})
