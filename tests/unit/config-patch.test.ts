import { describe, expect, test } from "bun:test"

import {
  AGENTS_ROWS,
  ROWS_BY_AGENT,
  SPACES_ROWS,
  agentRowsTemplate,
  captureBackup,
  detectConflicts,
  dotTokens,
  hasAgentTemplate,
  hasDots,
  installSidebar,
  refuseAgentDots,
  removeSidebar,
  restoreBackup,
  rowHasToken,
  sidebarTargets,
} from "../../src/config/patch.ts"
import { ConfigError } from "../../src/runtime/errors.ts"
import { PALETTE, allSlotTokens, slotToken } from "../../src/spaces/palette.ts"
import { MISSING, TomlDoc, TomlTable, isTomlList, type TomlValue } from "../../src/config/toml-edit.ts"

const USERS_REAL = `onboarding = false
# [ui]
# agent_panel_sort = "priority"

[theme]
# name = "one-dark"

name = "gruvbox"
auto_switch = false
[ui]
agent_panel_sort = "priority"
sidebar_width = 34

[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"]]


[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "herdr-file-viewer.open-file-viewer"
`

const NO_SIDEBAR = `[theme]
name = "catppuccin"

[terminal]
default_shell = "/bin/zsh"
`

const MULTILINE_ROWS = `[ui.sidebar.spaces]
# my carefully arranged rows
rows = [
  ["state_icon", "workspace"],
  ["branch", "git_status"],
]

[ui]
sidebar_width = 30
`

const STYLED_ROWS = `[ui.sidebar.agents]
rows = [[{ token = "state_icon" }, { token = "workspace", fg = "#89b4fa", bold = true }], ["agent"]]
`

const STYLED_SPACES = `[ui.sidebar.spaces]
rows = [[{ token = "state_icon" }, { token = "workspace", fg = "#89b4fa", bold = true }], ["branch", "git_status"]]
`

const EXISTING_THEME = `[theme]
name = "nord"

[theme.custom]
# I like this pink
accent = "#f5c2e7"
red = "#ff6188"

[ui]
accent = "cyan"
`

const LEGACY_EMOJI = `[ui.sidebar.spaces]
rows = [["state_icon", "$space_emoji", "workspace"], ["branch", "git_status"]]

[ui.sidebar.agents]
rows = [["state_icon", "$space_emoji", "workspace", "tab"], ["agent"]]
`

const ROWS_BY_AGENT_FIXTURE = `[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.agents.rows_by_agent]
claude = [["state_icon", "workspace", "tab"], ["agent"]]
`

function dotsLiteral(head: string, tail: string): string {
  const toks = PALETTE.map(([name, hex]) => `{ token = "$sd_${name}", fg = "${hex}" }`).join(", ")

  return `[${head}, ${toks}, ${tail}]`
}

const ALREADY_INSTALLED = `[ui.sidebar.spaces]\nrows = [${dotsLiteral('"state_icon"', '"workspace"')}]\n`

function tokenOf(entry: TomlValue | undefined): string | undefined {
  if (entry === undefined) return undefined

  if (Object.prototype.toString.call(entry) === "[object String]") {
    return String(entry)
  }

  if (entry instanceof TomlTable) {
    const token = entry.get("token")

    return Object.prototype.toString.call(token) === "[object String]" ? String(token) : undefined
  }

  return undefined
}

describe("sidebar install", () => {
  test("merges users_real config", () => {
    const doc = new TomlDoc(USERS_REAL)
    const { changes } = installSidebar(doc, 0)
    const labels = new Set(changes.map((change) => change.key))

    expect(labels.has("ui.sidebar.spaces.rows")).toBe(true)
    expect(labels.has("ui.sidebar.agents.rows")).toBe(true)
  })

  test("preserves existing rows_by_agent", () => {
    const doc = new TomlDoc(ROWS_BY_AGENT_FIXTURE)
    const before = doc.get(["ui", "sidebar", "agents", "rows_by_agent", "claude"])
    const beforeDump = doc.dumps()
    const { changes } = installSidebar(doc, 0)
    const labels = new Set(changes.map((change) => change.key))

    expect(labels.has("ui.sidebar.agents.rows_by_agent.claude")).toBe(false)
    expect(doc.get(["ui", "sidebar", "agents", "rows_by_agent", "claude"])).toEqual(before)
    expect(hasDots(doc.get(["ui", "sidebar", "agents", "rows_by_agent", "claude"]))).toBe(false)
    expect(doc.dumps()).toContain("[ui.sidebar.agents.rows_by_agent]")
    expect(doc.dumps()).toContain(beforeDump.split("[ui.sidebar.agents.rows_by_agent]")[1] ?? "")
  })

  test("never creates rows_by_agent entries", () => {
    const doc = new TomlDoc(USERS_REAL)

    installSidebar(doc, 0)
    expect(doc.tableKeys(ROWS_BY_AGENT)).toEqual([])
  })

  test("installed rows have the correct order", () => {
    const doc = new TomlDoc(USERS_REAL)

    installSidebar(doc, 0)
    const spaces = doc.get(SPACES_ROWS)
    const n = PALETTE.length

    expect(isTomlList(spaces)).toBe(true)

    if (!isTomlList(spaces)) return

    const row = spaces[0]

    expect(isTomlList(row)).toBe(true)

    if (!isTomlList(row)) return

    expect(row[0]).toBe("state_icon")

    const slots = row.slice(1, 1 + n).map(tokenOf)

    expect(slots).toEqual(allSlotTokens().map((name) => `$${name}`))
    expect(row[1 + n]).toBe("workspace")

    const agents = doc.get(AGENTS_ROWS)

    expect(isTomlList(agents)).toBe(true)

    if (!isTomlList(agents)) return

    const agentRow = agents[0]

    expect(isTomlList(agentRow)).toBe(true)

    if (!isTomlList(agentRow)) return

    expect(agentRow[0]).toBe("state_icon")
    expect(tokenOf(agentRow[1])).toBe("$elapsed")

    const titles = agentRow.slice(2, 2 + n).map(tokenOf)

    expect(titles).toEqual(PALETTE.map(([name]) => `$title_${name}`))
    expect(tokenOf(agentRow[agentRow.length - 1])).toBe("$themed_model_tier")
    expect(agentRow).toHaveLength(15)
    expect(hasDots(agents)).toBe(false)
  })

  test("each slot token carries its own static colour", () => {
    const doc = new TomlDoc(USERS_REAL)

    installSidebar(doc, 0)
    const spaces = doc.get(SPACES_ROWS)

    expect(isTomlList(spaces)).toBe(true)

    if (!isTomlList(spaces)) return

    const row = spaces[0]

    expect(isTomlList(row)).toBe(true)

    if (!isTomlList(row)) return

    const styled = new Map<string, TomlValue>()

    for (const entry of row) {
      if (entry instanceof TomlTable) {
        const token = entry.get("token")
        const fg = entry.get("fg")

        if (token !== undefined && fg !== undefined) styled.set(String(token), fg)
      }
    }

    for (const [name, hex] of PALETTE) {
      expect(styled.get(`$${slotToken(name)}`)).toBe(hex)
    }
  })

  test("state_icon remains present", () => {
    const doc = new TomlDoc(USERS_REAL)

    installSidebar(doc, 0)
    expect(rowHasToken(doc.get(SPACES_ROWS), "state_icon")).toBe(true)
    expect(rowHasToken(doc.get(AGENTS_ROWS), "state_icon")).toBe(true)
  })

  test("branch and git_status are preserved", () => {
    const doc = new TomlDoc(USERS_REAL)

    installSidebar(doc, 0)
    const rows = doc.get(SPACES_ROWS)

    expect(isTomlList(rows)).toBe(true)

    if (!isTomlList(rows)) return

    expect(rows).toContainEqual(["branch", "git_status"])
  })

  test("legacy emoji token is replaced by dots", () => {
    const doc = new TomlDoc(LEGACY_EMOJI)

    installSidebar(doc, 0)
    const out = doc.dumps()

    expect(out).not.toContain("$space_emoji")
    expect(hasDots(doc.get(SPACES_ROWS))).toBe(true)
    expect(hasDots(doc.get(AGENTS_ROWS))).toBe(false)
    expect(hasAgentTemplate(doc.get(AGENTS_ROWS))).toBe(true)
  })

  test("install is idempotent", () => {
    const doc = new TomlDoc(USERS_REAL)

    installSidebar(doc, 0)
    const first = doc.dumps()
    const second = installSidebar(doc, 0)

    expect(second.changes).toEqual([])
    expect(doc.dumps()).toBe(first)
  })

  test("already installed spaces fixture is a noop for spaces", () => {
    const doc = new TomlDoc(ALREADY_INSTALLED)
    const before = doc.get(SPACES_ROWS)
    const { changes } = installSidebar(doc, 0)
    const spaceChanges = changes.filter((change) => change.key.startsWith("ui.sidebar.spaces"))

    expect(spaceChanges).toEqual([])
    expect(doc.get(SPACES_ROWS)).toEqual(before)
  })

  test("materialises defaults when absent", () => {
    const doc = new TomlDoc(NO_SIDEBAR)
    const { changes } = installSidebar(doc, 0)

    expect(changes.some((change) => change.origin === "materialised default")).toBe(true)

    const rows = doc.get(SPACES_ROWS)

    expect(hasDots(rows)).toBe(true)
    expect(isTomlList(rows)).toBe(true)

    if (!isTomlList(rows)) return

    const first = rows[0]

    expect(isTomlList(first)).toBe(true)

    if (!isTomlList(first)) return

    expect(first[0]).toBe("state_icon")
    expect(first[first.length - 1]).toBe("workspace")
    expect(rows[1]).toEqual(["branch", "git_status"])
  })

  test("preserves unrelated config", () => {
    const doc = new TomlDoc(USERS_REAL)

    installSidebar(doc, 0)
    const out = doc.dumps()

    for (const needle of [
      "onboarding = false",
      "sidebar_width = 34",
      'agent_panel_sort = "priority"',
      'key = "prefix+f"',
      "# name = \"one-dark\"",
      "herdr-file-viewer.open-file-viewer",
    ]) {
      expect(out).toContain(needle)
    }
  })

  test("preserves comments in multiline rows", () => {
    const doc = new TomlDoc(MULTILINE_ROWS)

    installSidebar(doc, 0)
    const out = doc.dumps()

    expect(out).toContain("# my carefully arranged rows")
    expect(out).toContain("sidebar_width = 30")
  })

  test("styled space tokens are preserved", () => {
    const doc = new TomlDoc(STYLED_SPACES)

    installSidebar(doc, 0)
    const rows = doc.get(SPACES_ROWS)

    expect(isTomlList(rows)).toBe(true)

    if (!isTomlList(rows)) return

    const first = rows[0]

    expect(isTomlList(first)).toBe(true)

    if (!isTomlList(first)) return

    expect(first[0]).toBeInstanceOf(TomlTable)
    expect(tokenOf(first[0])).toBe("state_icon")
    expect(hasDots(rows)).toBe(true)
    expect(first[first.length - 1]).toBeInstanceOf(TomlTable)
    expect(tokenOf(first[first.length - 1])).toBe("workspace")
  })

  test("custom agent rows are replaced with the title template", () => {
    const doc = new TomlDoc(STYLED_ROWS)
    const { backup, changes } = installSidebar(doc, 0)

    expect(changes.some((change) => change.key === "ui.sidebar.agents.rows")).toBe(true)
    expect(hasAgentTemplate(doc.get(AGENTS_ROWS))).toBe(true)
    expect(backup.keys["ui.sidebar.agents.rows"]?.present).toBe(true)
  })

  test("exact restoration of sidebar", () => {
    const doc = new TomlDoc(USERS_REAL)
    const original = doc.dumps()
    const { backup } = installSidebar(doc, 0)

    expect(doc.dumps()).not.toBe(original)
    removeSidebar(doc, backup)
    expect(doc.dumps()).toBe(original)
  })

  test("exact restoration when key was absent", () => {
    const doc = new TomlDoc(NO_SIDEBAR)
    const original = doc.dumps()
    const { backup } = installSidebar(doc, 0)

    removeSidebar(doc, backup)
    expect(doc.dumps().trim()).toBe(original.trim())
  })
})

describe("backup and conflicts", () => {
  test("distinguishes absent from present", () => {
    const doc = new TomlDoc(EXISTING_THEME)

    const backup = captureBackup(doc, [
      "theme.custom.accent",
      "theme.custom.surface0",
      "ui.accent",
    ], 0)

    expect(backup.keys["theme.custom.accent"]).toEqual({ present: true, value: "#f5c2e7" })
    expect(backup.keys["theme.custom.surface0"]).toEqual({ present: false })
    expect(backup.keys["ui.accent"]).toEqual({ present: true, value: "cyan" })
  })

  test("detects conflicts", () => {
    const doc = new TomlDoc(EXISTING_THEME)
    const conflicts = detectConflicts(doc, [["theme.custom.accent", "#111111"]])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.key).toBe("theme.custom.accent")
    expect(conflicts[0]?.actual).toBe("#f5c2e7")
  })

  test("no conflict when values match", () => {
    const doc = new TomlDoc(EXISTING_THEME)

    expect(detectConflicts(doc, [["theme.custom.accent", "#f5c2e7"]])).toEqual([])
  })

  test("restore skips user-modified keys", () => {
    const doc = new TomlDoc(EXISTING_THEME)
    const backup = captureBackup(doc, ["theme.custom.accent"], 0)
    const results = restoreBackup(doc, backup, [], new Set(["theme.custom.accent"]))

    expect(results).toEqual([["theme.custom.accent", "skipped (user-modified)"]])
  })
})

describe("token limits", () => {
  test("agent row is fifteen tokens without space dots", () => {
    const row = agentRowsTemplate()[0]

    expect(row).toHaveLength(15)
    expect(hasDots([row ?? []])).toBe(false)
    expect(rowHasToken(agentRowsTemplate(), "$elapsed")).toBe(true)
    expect(rowHasToken(agentRowsTemplate(), "$themed_model_tier")).toBe(true)
  })

  test("agent row plus twelve dots is rejected", () => {
    const template = agentRowsTemplate()[0] ?? []
    const mixed = [[template[0] ?? "state_icon", ...dotTokens(), ...template.slice(1)]]
    const mixedRow = mixed[0]

    expect(mixedRow !== undefined && mixedRow.length > 16).toBe(true)

    try {
      refuseAgentDots(mixed, "ui.sidebar.agents.rows")
      throw new Error("expected ConfigError")
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const message = error instanceof ConfigError ? error.message : ""

      expect(message).toContain("15-token")
      expect(message).toContain("max 16")
    }
  })

  test("sidebarTargets lists existing rows_by_agent without rewriting them", () => {
    const doc = new TomlDoc(ROWS_BY_AGENT_FIXTURE)
    const labels = sidebarTargets(doc).map((target) => target[2])

    expect(labels).toContain("ui.sidebar.agents.rows_by_agent.claude")
    expect(doc.get(["ui", "sidebar", "agents", "rows_by_agent", "claude"])).not.toBe(MISSING)
  })
})
