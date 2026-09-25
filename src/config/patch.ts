import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { Clock, Duration, Effect } from "effect"

import { MAX_ROWS, MAX_TOKENS_PER_ROW } from "../ids.ts"
import { ConfigError } from "../runtime/errors.ts"
import { atomicWrite } from "../runtime/lock.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { PALETTE, slotToken } from "../spaces/palette.ts"
import {
  TomlDoc,
  TomlTable,
  dumpValue,
  isMissing,
  isTomlList,
  isTomlString,
  tomlEqual,
  type Missing,
  type TomlKeyPath,
  type TomlSection,
  type TomlValue,
} from "./toml-edit.ts"

export const SPACES_ROWS: TomlKeyPath = ["ui", "sidebar", "spaces", "rows"]

export const AGENTS_ROWS: TomlKeyPath = ["ui", "sidebar", "agents", "rows"]

export const ROWS_BY_AGENT: TomlKeyPath = ["ui", "sidebar", "agents", "rows_by_agent"]

export const DEFAULT_SPACES_ROWS: TomlValue[][] = [
  ["state_icon", "workspace"],
  ["branch", "git_status"],
]

export const LEGACY_CHROMATIC_AGENTS_ROWS: TomlValue[][] = [
  ["state_icon", "workspace", "tab"],
  ["agent"],
]

export const LEGACY_EMOJI_TOKEN = "$space_emoji"

export const SPACE_NAME_TOKEN = "$space_name"

export const SIDEBAR_TIDY_TABLES: readonly TomlKeyPath[] = [
  ["ui", "sidebar", "spaces"],
  ["ui", "sidebar", "agents"],
]

export type KeyBackup =
  | { readonly present: false }
  | { readonly present: true; readonly value: TomlValue }

export type SidebarBackup = {
  readonly captured_unix: number
  readonly keys: { readonly [key: string]: KeyBackup }
}

export type SidebarChange = {
  readonly key: string
  readonly origin: string
  readonly rows: TomlValue
}

export type OwnedSidebarValue = {
  readonly key: string
  readonly value: TomlValue
}

export type InstallSidebarResult = {
  readonly backup: SidebarBackup
  readonly changes: SidebarChange[]
  readonly warnings: string[]
}

export type ConflictHit = {
  readonly key: string
  readonly expected: TomlValue
  readonly actual: TomlValue | undefined
}

function isDottedPath(key: string | TomlKeyPath): key is TomlKeyPath {
  return Array.isArray(key)
}

export function dotted(key: string | TomlKeyPath): TomlKeyPath {
  if (isDottedPath(key)) return key

  return key.split(".")
}

export function ownedSidebarKeys(): string[] {
  return ["ui.sidebar.spaces.rows", "ui.sidebar.agents.rows"]
}

export function loadDoc(path: string): TomlDoc {
  if (!existsSync(path)) return new TomlDoc("")

  return TomlDoc.load(path)
}

export function dotTokens(): TomlTable[] {
  const tokens: TomlTable[] = []

  for (const [name, hex] of PALETTE) {
    tokens.push(new TomlTable([["token", `$${slotToken(name)}`], ["fg", hex]]))
  }

  return tokens
}

export function titleTokens(): TomlTable[] {
  const tokens: TomlTable[] = []

  for (const [name, hex] of PALETTE) {
    tokens.push(new TomlTable([["token", `$title_${name}`], ["fg", hex], ["dim", false]]))
  }

  return tokens
}

export function agentRowsTemplate(): TomlValue[][] {
  return [[
    "state_icon",
    new TomlTable([["token", "$elapsed"], ["dim", true]]),
    ...titleTokens(),
    new TomlTable([["token", "$themed_model_tier"], ["dim", true]]),
  ]]
}

export function tokenName(entry: TomlValue): string | undefined {
  if (isTomlString(entry)) return entry

  if (entry instanceof TomlTable) {
    const token = entry.get("token")

    if (isTomlString(token)) return token
  }

  return undefined
}

function bare(name: string): string {
  let i = 0

  while (name[i] === "$") i += 1

  return name.slice(i)
}

function normalizeEntry(entry: TomlValue): string {
  if (entry instanceof TomlTable) {
    return `dict:${String(entry.get("token"))}:${String(entry.get("fg"))}:${String(entry.get("dim"))}`
  }

  return `str:${String(entry)}`
}

function normalizeRows(rows: TomlValue | Missing): string {
  if (!isTomlList(rows)) return ""

  const parts: string[] = []

  for (const row of rows) {
    const entries = isTomlList(row) ? row : []
    const inner: string[] = []

    for (const entry of entries) {
      inner.push(normalizeEntry(entry))
    }

    parts.push(inner.join("|"))
  }

  return parts.join("/")
}

export function hasAgentTemplate(rows: TomlValue | Missing): boolean {
  return normalizeRows(rows) === normalizeRows(agentRowsTemplate())
}

export function hasTitleTokens(rows: TomlValue | Missing): boolean {
  if (!isTomlList(rows)) return false

  const names = new Set(titleTokens().map((token) => bare(String(token.get("token") ?? ""))))

  for (const row of rows) {
    if (!isTomlList(row)) continue

    for (const entry of row) {
      const name = tokenName(entry)

      if (name !== undefined && names.has(bare(name))) return true
    }
  }

  return false
}

export function agentRowTokenCount(rows: TomlValue | undefined): number {
  const resolved = rows === undefined ? agentRowsTemplate() : rows

  if (!isTomlList(resolved) || resolved.length === 0) return 0

  const first = resolved[0]

  return isTomlList(first) ? first.length : 0
}

export function rowHasToken(rows: TomlValue | Missing, token: string): boolean {
  if (!isTomlList(rows)) return false

  const want = bare(token)

  for (const row of rows) {
    if (!isTomlList(row)) continue

    for (const entry of row) {
      const name = tokenName(entry)

      if (name !== undefined && bare(name) === want) return true
    }
  }

  return false
}

export function hasDots(rows: TomlValue | Missing): boolean {
  if (!isTomlList(rows)) return false

  const names = new Set(dotTokens().map((token) => bare(String(token.get("token") ?? ""))))

  for (const row of rows) {
    if (!isTomlList(row)) continue

    for (const entry of row) {
      const name = tokenName(entry)

      if (name !== undefined && names.has(bare(name))) return true
    }
  }

  return false
}

export function stripTokens(rows: TomlValue, tokens: readonly string[]): TomlValue[][] {
  const want = new Set(tokens.map(bare))
  const out: TomlValue[][] = []

  if (!isTomlList(rows)) return out

  for (const row of rows) {
    const next: TomlValue[] = []

    if (isTomlList(row)) {
      for (const entry of row) {
        const name = tokenName(entry)

        if (name === undefined || !want.has(bare(name))) next.push(entry)
      }
    }

    out.push(next)
  }

  return out
}

export function insertTokens(
  rows: TomlValue,
  tokens: readonly TomlValue[],
  after = "state_icon",
): TomlValue[][] {
  const copied: TomlValue[][] = []

  if (isTomlList(rows)) {
    for (const row of rows) {
      copied.push(isTomlList(row) ? [...row] : [])
    }
  }

  if (copied.length === 0) copied.push([])

  if (hasDots(copied)) return copied

  for (const row of copied) {
    for (let i = 0; i < row.length; i++) {
      const entry = row[i]

      if (entry === undefined) continue

      const name = tokenName(entry)

      if (name !== undefined && bare(name) === after) {
        row.splice(i + 1, 0, ...tokens)

        return copied
      }
    }
  }

  const first = copied[0]

  if (first !== undefined) first.splice(0, 0, ...tokens)

  return copied
}

export function checkLimits(rows: TomlValue[][], label: string): void {
  if (rows.length > MAX_ROWS) {
    throw new ConfigError({ message: `${label} would exceed ${MAX_ROWS} rows` })
  }

  for (const row of rows) {
    if (row.length > MAX_TOKENS_PER_ROW) {
      throw new ConfigError({
        message: `${label} would need ${row.length} tokens in one row (max ${MAX_TOKENS_PER_ROW}). Reduce the palette `
          + `in identity.PALETTE or shorten that row.`,
      })
    }
  }
}

export function refuseAgentDots(rows: TomlValue, label: string): void {
  if (!isTomlList(rows)) return

  if (hasDots(rows) && (hasTitleTokens(rows) || hasAgentTemplate(rows))) {
    let n = 0

    for (const row of rows) {
      if (isTomlList(row) && row.length > n) n = row.length
    }

    throw new ConfigError({
      message: `${label} would combine 12 space dots with the 15-token agent title row `
        + `(${n} tokens; Herdr max ${MAX_TOKENS_PER_ROW}). Space dots stay on ui.sidebar.spaces.rows.`,
    })
  }

  const listRows: TomlValue[][] = []

  for (const row of rows) {
    listRows.push(isTomlList(row) ? row : [])
  }

  checkLimits(listRows, label)
}

export function sidebarTargets(doc: TomlDoc): Array<readonly [TomlKeyPath, TomlValue | undefined, string]> {
  const targets: Array<readonly [TomlKeyPath, TomlValue | undefined, string]> = [
    [SPACES_ROWS, DEFAULT_SPACES_ROWS, "ui.sidebar.spaces.rows"],
    [AGENTS_ROWS, agentRowsTemplate(), "ui.sidebar.agents.rows"],
  ]

  for (const agent of doc.tableKeys(ROWS_BY_AGENT)) {
    targets.push([
      [...ROWS_BY_AGENT, agent],
      undefined,
      `ui.sidebar.agents.rows_by_agent.${agent}`,
    ])
  }

  return targets
}

export function currentOwnedSidebar(doc: TomlDoc): OwnedSidebarValue[] {
  const out: OwnedSidebarValue[] = []

  for (const key of ownedSidebarKeys()) {
    const val = doc.get(dotted(key))

    if (!isMissing(val)) out.push({ key, value: val })
  }

  return out
}

export function captureBackup(
  doc: TomlDoc,
  keys: readonly string[],
  capturedUnix: number,
): SidebarBackup {
  const collected: { [key: string]: KeyBackup } = {}

  for (const key of keys) {
    const val = doc.get(dotted(key))

    if (isMissing(val)) collected[key] = { present: false }
    else collected[key] = { present: true, value: val }
  }

  return { keys: collected, captured_unix: capturedUnix }
}

export function applyValues(
  doc: TomlDoc,
  values: ReadonlyArray<readonly [string, TomlValue]>,
): void {
  const sorted = [...values].sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)

  for (const [key, val] of sorted) {
    doc.set(dotted(key), val)
  }
}

export function restoreBackup(
  doc: TomlDoc,
  backup: SidebarBackup | undefined,
  tidyTables: readonly TomlKeyPath[] = [],
  skip: ReadonlySet<string> = new Set(),
): Array<readonly [string, string]> {
  if (backup === undefined) return []

  const restored: Array<readonly [string, string]> = []
  const keys = Object.keys(backup.keys).sort()

  for (const key of keys) {
    const info = backup.keys[key]

    if (info === undefined) continue

    if (skip.has(key)) {
      restored.push([key, "skipped (user-modified)"])
      continue
    }

    const path = dotted(key)

    if (info.present) {
      const wanted = info.value

      if (!tomlEqual(doc.get(path), wanted)) doc.set(path, wanted)

      restored.push([key, "restored"])
    } else if (doc.unset(path)) {
      restored.push([key, "removed"])
    }
  }

  for (const table of tidyTables) {
    if (doc.tableIsEmpty(table)) doc.removeTable(table)
  }

  return restored
}

export function detectConflicts(
  doc: TomlDoc,
  lastWritten: ReadonlyArray<readonly [string, TomlValue]> | undefined,
  onlyKeys: ReadonlySet<string> | undefined = undefined,
): ConflictHit[] {
  const out: ConflictHit[] = []
  const source = lastWritten ?? []

  const entries = [...source].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )

  for (const [key, expected] of entries) {
    if (onlyKeys !== undefined && !onlyKeys.has(key)) continue

    const actual = doc.get(dotted(key))

    if (isMissing(actual)) {
      out.push({ key, expected, actual: undefined })
    } else if (!tomlEqual(actual, expected)) {
      out.push({ key, expected, actual })
    }
  }

  return out
}

export function installSidebar(
  doc: TomlDoc,
  capturedUnix: number,
): InstallSidebarResult {
  const backup = captureBackup(doc, ownedSidebarKeys(), capturedUnix)
  const changes: SidebarChange[] = []
  const warnings: string[] = []
  const spaces = doc.get(SPACES_ROWS)
  let current: TomlValue
  let origin: string
  let present: boolean

  if (isMissing(spaces)) {
    current = DEFAULT_SPACES_ROWS
    origin = "materialised default"
    present = false
  } else {
    current = spaces
    origin = "merged"
    present = true
  }

  if (!isTomlList(current)) {
    warnings.push("ui.sidebar.spaces.rows is not a list of rows; skipping")
  } else {
    const cleaned = stripTokens(current, [LEGACY_EMOJI_TOKEN])
    const merged = insertTokens(cleaned, dotTokens())

    refuseAgentDots(merged, "ui.sidebar.spaces.rows")

    if (!present || !tomlEqual(merged, current)) {
      checkLimits(merged, "ui.sidebar.spaces.rows")
      doc.set(SPACES_ROWS, merged)
      changes.push({ key: "ui.sidebar.spaces.rows", origin, rows: merged })
    }
  }

  const agents = doc.get(AGENTS_ROWS)
  const template = agentRowsTemplate()

  refuseAgentDots(template, "ui.sidebar.agents.rows")

  if (isMissing(agents)) {
    doc.set(AGENTS_ROWS, template)
    changes.push({ key: "ui.sidebar.agents.rows", origin: "materialised default", rows: template })
  } else if (!isTomlList(agents)) {
    warnings.push("ui.sidebar.agents.rows is not a list of rows; skipping")
  } else if (!hasAgentTemplate(agents)) {
    refuseAgentDots(template, "ui.sidebar.agents.rows")
    checkLimits(template, "ui.sidebar.agents.rows")
    doc.set(AGENTS_ROWS, template)
    changes.push({ key: "ui.sidebar.agents.rows", origin: "replaced", rows: template })
  }

  return { backup, changes, warnings }
}

export function removeSidebar(doc: TomlDoc, backup: SidebarBackup | undefined) {
  return restoreBackup(doc, backup, SIDEBAR_TIDY_TABLES)
}

function diagLines(output: string): Set<string> {
  const out = new Set<string>()

  for (const raw of output.split("\n")) {
    const line = raw.trim()

    if (line === "" || line.startsWith("config: ")) continue

    out.add(line)
  }

  return out
}

type CheckResult = {
  readonly rc: number | undefined
  readonly output: string
}

const runCheck = Effect.fnUntraced(function*(text: string): Effect.fn.Return<CheckResult, never, PluginPaths> {
  const paths = yield* PluginPaths
  const tmp = join(paths.stateDir, `.candidate.${process.pid}.toml`)

  mkdirSync(paths.stateDir, { recursive: true })
  writeFileSync(tmp, text, "utf8")

  try {
    const proc = Bun.spawn([paths.herdrBin, "config", "check"], {
      env: { ...process.env, HERDR_CONFIG_PATH: tmp },
      stdout: "pipe",
      stderr: "pipe",
    })

    const finished = yield* Effect.tryPromise({
      try: async () => {
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        const rc = await proc.exited

        return { rc, output: `${stdout}${stderr}`.trim() }
      },
      catch: (error) => new ConfigError({
        message: `could not run \`herdr config check\`: ${String(error)}`,
      }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(20),
        orElse: () =>
          new ConfigError({ message: "could not run `herdr config check`: timed out" }),
      }),
      Effect.catchTag("ConfigError", (error) =>
        Effect.succeed({ rc: undefined, output: error.message } satisfies CheckResult)
      ),
    )

    return finished
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // candidate files are disposable
    }
  }
})

export const validate = Effect.fnUntraced(function*(
  text: string,
  baselineText: string | undefined = undefined,
) {
  const checked = yield* runCheck(text)

  if (checked.rc === undefined) return { ok: false, output: checked.output } as const

  if (checked.output.includes("config parse error")) {
    return { ok: false, output: checked.output } as const
  }

  if (checked.rc === 0) return { ok: true, output: checked.output } as const

  if (baselineText === undefined) return { ok: false, output: checked.output } as const

  const baseline = yield* runCheck(baselineText)

  if (baseline.rc === undefined) return { ok: false, output: checked.output } as const

  const introduced = [...diagLines(checked.output)].filter((line) => !diagLines(baseline.output).has(line))

  if (introduced.length > 0) {
    return {
      ok: false,
      output: `new diagnostics introduced: ${introduced.sort().join("; ")}`,
    } as const
  }

  return { ok: true, output: checked.output } as const
})

export const snapshotConfig = Effect.fnUntraced(function*(path: string, stateDir: string) {
  if (!existsSync(path)) return undefined

  const ms = yield* Clock.currentTimeMillis
  const stamp = formatStamp(ms)
  const dest = join(stateDir, `config.backup.${stamp}.toml`)

  mkdirSync(stateDir, { recursive: true })
  copyFileSync(path, dest)
  pruneSnapshots(stateDir)

  return dest
})

function formatStamp(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number, width = 2) => String(n).padStart(width, "0")

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function pruneSnapshots(stateDir: string, keep = 10): void {
  let files: string[] = []

  try {
    files = readdirSync(stateDir)
      .filter((name) => name.startsWith("config.backup.") && name.endsWith(".toml"))
      .sort()
  } catch {
    return
  }

  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      unlinkSync(join(stateDir, name))
    } catch {
      // leftover backups must not fail the write
    }
  }
}

export const commitDoc = Effect.fnUntraced(function*(doc: TomlDoc, path: string) {
  const text = doc.dumps()
  const baseline = existsSync(path) ? TomlDoc.load(path).dumps() : undefined
  const checked = yield* validate(text, baseline)

  if (!checked.ok) {
    return yield* new ConfigError({
      message: `refusing to write invalid config: ${checked.output}`,
    })
  }

  atomicWrite(path, text)

  return checked.output
})

export const KEYBIND_MARKER = "# added by iurysza.mosaic"

export const KEYS_COMMAND: TomlKeyPath = ["keys", "command"]

export type KeybindStatus = "exists" | "occupied" | "added"

export type KeybindInstallResult = {
  readonly status: KeybindStatus
  readonly bound: string | undefined
}

function optionalScalar(value: TomlValue | Missing): string | undefined {
  if (isMissing(value)) return undefined

  if (isTomlString(value)) return value

  return String(value)
}

export function findKeybind(doc: TomlDoc, command: string): TomlSection | undefined {
  for (const section of doc.aotSections(KEYS_COMMAND)) {
    if (doc.sectionScalar(section, "command") === command) return section
  }

  return undefined
}

export function findBindingForKey(doc: TomlDoc, key: string): TomlSection | undefined {
  for (const section of doc.aotSections(KEYS_COMMAND)) {
    if (doc.sectionScalar(section, "key") === key) return section
  }

  return undefined
}

export function chordHolder(doc: TomlDoc, chord: string): string | undefined {
  const command = findBindingForKey(doc, chord)

  if (command !== undefined) {
    return optionalScalar(doc.sectionScalar(command, "command")) ?? "keys.command"
  }

  for (const name of doc.tableKeys(["keys"])) {
    const value = doc.get(["keys", name])

    if (!isMissing(value) && isTomlString(value) && value === chord) return `keys.${name}`
  }

  return undefined
}

export function nativeKeyValue(doc: TomlDoc, action: string): string | undefined {
  const value = doc.get(["keys", action])

  if (isMissing(value)) return undefined

  if (isTomlString(value)) return value

  return String(value)
}

export function keybindKey(doc: TomlDoc, command: string): string | undefined {
  const section = findKeybind(doc, command)

  if (section === undefined) return undefined

  return optionalScalar(doc.sectionScalar(section, "key"))
}

export function installKeybind(
  doc: TomlDoc,
  key: string,
  command: string,
  description: string,
): KeybindInstallResult {
  const existing = findKeybind(doc, command)

  if (existing !== undefined) {
    return {
      status: "exists",
      bound: optionalScalar(doc.sectionScalar(existing, "key")),
    }
  }

  const occupied = findBindingForKey(doc, key)

  if (occupied !== undefined) {
    return {
      status: "occupied",
      bound: optionalScalar(doc.sectionScalar(occupied, "command")),
    }
  }

  doc.appendLines([
    KEYBIND_MARKER,
    "[[keys.command]]",
    `key = ${dumpValue(key)}`,
    'type = "plugin_action"',
    `command = ${dumpValue(command)}`,
    `description = ${dumpValue(description)}`,
  ])

  return { status: "added", bound: key }
}

export function removeKeybind(doc: TomlDoc, command: string): boolean {
  const section = findKeybind(doc, command)

  if (section === undefined) return false

  doc.removeSection(section)

  return true
}

export type ActionRenameRecord = {
  readonly key: string | undefined
  readonly command: string
  readonly before: readonly string[]
  readonly after: readonly string[]
}

export function renamePluginActions(
  doc: TomlDoc,
  oldId: string,
  newId: string,
): ActionRenameRecord[] {
  const records: ActionRenameRecord[] = []
  const prefix = `${oldId}.`

  for (const section of [...doc.aotSections(KEYS_COMMAND)].reverse()) {
    const command = doc.sectionScalar(section, "command")

    if (doc.sectionScalar(section, "type") !== "plugin_action") continue

    if (isMissing(command) || !isTomlString(command) || !command.startsWith(prefix)) continue

    const key = optionalScalar(doc.sectionScalar(section, "key"))
    const replacement = `${newId}${command.slice(oldId.length)}`
    const before = doc.lines.slice(section.start, section.end)

    doc.setSectionScalar(section, "command", replacement)

    const changed: TomlSection[] = []

    for (const candidate of doc.aotSections(KEYS_COMMAND)) {
      if (doc.sectionScalar(candidate, "command") === replacement
        && optionalScalar(doc.sectionScalar(candidate, "key")) === key) {
        changed.push(candidate)
      }
    }

    if (changed.length !== 1 || changed[0] === undefined) {
      throw new ConfigError({ message: `ambiguous binding while migrating ${command}` })
    }

    records.push({
      key,
      command: replacement,
      before,
      after: doc.lines.slice(changed[0].start, changed[0].end),
    })
  }

  return records
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false

  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }

  return true
}

export function restoreActionRenames(
  doc: TomlDoc,
  records: readonly ActionRenameRecord[],
): ActionRenameRecord[] {
  const remaining: ActionRenameRecord[] = []

  for (const record of records) {
    const keyed: TomlSection[] = []

    for (const section of doc.aotSections(KEYS_COMMAND)) {
      if (optionalScalar(doc.sectionScalar(section, "key")) === record.key) {
        keyed.push(section)
      }
    }

    let alreadyRestored = false

    for (const section of keyed) {
      if (sameLines(doc.lines.slice(section.start, section.end), record.before)) {
        alreadyRestored = true
        break
      }
    }

    if (alreadyRestored) continue

    const matches: TomlSection[] = []

    for (const section of keyed) {
      if (doc.sectionScalar(section, "command") === record.command) matches.push(section)
    }

    if (matches.length !== 1 || matches[0] === undefined) {
      remaining.push(record)
      continue
    }

    const section = matches[0]

    if (!sameLines(doc.lines.slice(section.start, section.end), record.after)) {
      remaining.push(record)
      continue
    }

    doc.lines.splice(section.start, section.end - section.start, ...record.before)
    doc.reindex()
  }

  return remaining
}
