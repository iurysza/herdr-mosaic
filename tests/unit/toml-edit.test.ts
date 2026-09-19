import { describe, expect, test } from "bun:test"

import {
  MISSING,
  TomlDoc,
  dumpValue,
  parseValue,
  splitKeyPath,
} from "../../src/config/toml-edit.ts"

const REAL_CONFIG = `onboarding = false
# [ui]
# agent_panel_sort = "priority"

[theme]
# name = "one-dark"

name = "gruvbox"
auto_switch = false
[ui]
agent_panel_sort = "priority"
show_agent_labels_on_pane_borders = true
sidebar_width = 34

[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.agents.rows_by_agent]
claude = [["state_icon", "workspace", "tab"], ["terminal_title_stripped"], ["agent"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"]]


[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "herdr-file-viewer.open-file-viewer"
`

describe("key paths", () => {
  test("bare", () => {
    expect(splitKeyPath("ui.sidebar.spaces")).toEqual(["ui", "sidebar", "spaces"])
  })

  test("quoted", () => {
    expect(splitKeyPath('a."b.c".d')).toEqual(["a", "b.c", "d"])
  })
})

describe("values", () => {
  test("nested array", () => {
    expect(parseValue('[["state_icon", "workspace"], ["branch"]]')).toEqual([
      ["state_icon", "workspace"],
      ["branch"],
    ])
  })

  test("inline table", () => {
    expect(dumpValue(parseValue('{token = "workspace", fg = "#89b4fa", bold = true}'))).toBe(
      '{token = "workspace", fg = "#89b4fa", bold = true}',
    )
  })

  test("roundtrip emoji", () => {
    expect(parseValue(dumpValue("\u{1f310}"))).toBe("\u{1f310}")
  })

  test("dump nested", () => {
    expect(dumpValue([["a"], ["b", "c"]])).toBe('[["a"], ["b", "c"]]')
  })
})

describe("read real config", () => {
  test("exact roundtrip with no edits", () => {
    expect(new TomlDoc(REAL_CONFIG).dumps()).toBe(REAL_CONFIG)
  })

  test("read theme name", () => {
    expect(new TomlDoc(REAL_CONFIG).get(["theme", "name"])).toBe("gruvbox")
  })

  test("read spaces rows", () => {
    expect(new TomlDoc(REAL_CONFIG).get(["ui", "sidebar", "spaces", "rows"])).toEqual([
      ["state_icon", "workspace"],
      ["branch", "git_status"],
    ])
  })

  test("read agents rows", () => {
    expect(new TomlDoc(REAL_CONFIG).get(["ui", "sidebar", "agents", "rows"])).toEqual([
      ["state_icon", "workspace", "tab"],
      ["agent"],
    ])
  })

  test("read rows_by_agent claude", () => {
    expect(
      new TomlDoc(REAL_CONFIG).get(["ui", "sidebar", "agents", "rows_by_agent", "claude"]),
    ).toEqual([
      ["state_icon", "workspace", "tab"],
      ["terminal_title_stripped"],
      ["agent"],
    ])
  })

  test("commented key is not found", () => {
    expect(new TomlDoc(REAL_CONFIG).get(["ui", "agent_panel_sort"])).toBe("priority")
  })

  test("missing key", () => {
    const doc = new TomlDoc(REAL_CONFIG)

    expect(doc.get(["theme", "custom", "accent"])).toBe(MISSING)
    expect(doc.has(["ui", "accent"])).toBe(false)
  })

  test("array-of-tables is not treated as a table", () => {
    expect(new TomlDoc(REAL_CONFIG).get(["keys", "command", "key"])).toBe(MISSING)
  })
})

describe("writes", () => {
  test("set existing scalar preserves the rest", () => {
    const doc = new TomlDoc(REAL_CONFIG)

    doc.set(["theme", "name"], "nord")
    const out = doc.dumps()

    expect(out).toContain('name = "nord"')
    expect(out).toContain('# name = "one-dark"')
    expect(out).toContain("onboarding = false")
    expect(out.split("[theme]").length - 1).toBe(1)
  })

  test("set new key in existing table", () => {
    const doc = new TomlDoc(REAL_CONFIG)

    doc.set(["ui", "accent"], "#a970ff")
    expect(doc.get(["ui", "accent"])).toBe("#a970ff")

    const headers = doc.dumps().split("\n").filter((line) => line.trim() === "[ui]")

    expect(headers).toHaveLength(1)
  })

  test("set creates a new table", () => {
    const doc = new TomlDoc(REAL_CONFIG)

    doc.set(["theme", "custom", "accent"], "#4f8cff")
    const out = doc.dumps()

    expect(out.split("[theme.custom]").length - 1).toBe(1)
    expect(new TomlDoc(out).get(["theme", "custom", "accent"])).toBe("#4f8cff")
  })

  test("set array replaces the value", () => {
    const doc = new TomlDoc(REAL_CONFIG)
    const rows = [["state_icon", "$space_emoji", "workspace"], ["branch", "git_status"]]

    doc.set(["ui", "sidebar", "spaces", "rows"], rows)
    expect(doc.get(["ui", "sidebar", "spaces", "rows"])).toEqual(rows)
    expect(doc.dumps().split("[ui.sidebar.spaces]").length - 1).toBe(1)
  })

  test("unset restores original text", () => {
    const doc = new TomlDoc(REAL_CONFIG)

    doc.set(["theme", "custom", "accent"], "#4f8cff")
    doc.unset(["theme", "custom", "accent"])
    expect(doc.tableIsEmpty(["theme", "custom"])).toBe(true)
    doc.removeTable(["theme", "custom"])
    expect(doc.dumps()).toBe(REAL_CONFIG)
  })

  test("set then restore scalar is byte exact", () => {
    const doc = new TomlDoc(REAL_CONFIG)
    const orig = doc.get(["theme", "name"])

    if (orig === MISSING) throw new Error("theme.name missing")

    doc.set(["theme", "name"], "nord")
    doc.set(["theme", "name"], orig)
    expect(doc.dumps()).toBe(REAL_CONFIG)
  })

  test("table_is_empty is false when children exist", () => {
    expect(new TomlDoc(REAL_CONFIG).tableIsEmpty(["ui", "sidebar", "agents"])).toBe(false)
  })
})

describe("edge cases", () => {
  test("multiline array", () => {
    const src = 'x = 1\n[ui.sidebar.spaces]\nrows = [\n  ["state_icon"],\n  ["branch"],\n]\ny = 2\n'
    const doc = new TomlDoc(src)

    expect(doc.get(["ui", "sidebar", "spaces", "rows"])).toEqual([["state_icon"], ["branch"]])
    doc.set(["ui", "sidebar", "spaces", "rows"], [["a"]])
    const out = doc.dumps()

    expect(out).toContain('rows = [["a"]]')
    expect(out).toContain("y = 2")
  })

  test("dotted key in parent table", () => {
    const src = '[ui]\nsidebar.spaces.rows = [["state_icon"]]\n'
    const doc = new TomlDoc(src)

    expect(doc.get(["ui", "sidebar", "spaces", "rows"])).toEqual([["state_icon"]])
    doc.set(["ui", "sidebar", "spaces", "rows"], [["b"]])
    expect(doc.dumps()).toContain('sidebar.spaces.rows = [["b"]]')
  })

  test("hash inside string is not a comment", () => {
    const doc = new TomlDoc('[theme.custom]\naccent = "#a970ff" # my accent\n')

    expect(doc.get(["theme", "custom", "accent"])).toBe("#a970ff")
    doc.set(["theme", "custom", "accent"], "#123456")
    const out = doc.dumps()

    expect(out).toContain("# my accent")
    expect(new TomlDoc(out).get(["theme", "custom", "accent"])).toBe("#123456")
  })

  test("crlf is preserved", () => {
    const doc = new TomlDoc('[theme]\r\nname = "x"\r\n')

    doc.set(["theme", "name"], "y")
    expect(doc.dumps()).toContain("\r\n")
  })

  test("no trailing newline is preserved", () => {
    const doc = new TomlDoc('[theme]\nname = "x"')

    expect(doc.dumps()).toBe('[theme]\nname = "x"')
  })

  test("bracket in string is not a header", () => {
    const doc = new TomlDoc('a = "[not.a.header]"\n[theme]\nname = "x"\n')

    expect(doc.get(["theme", "name"])).toBe("x")
    expect(doc.get(["a"])).toBe("[not.a.header]")
  })

  test("empty file", () => {
    const doc = new TomlDoc("")

    doc.set(["ui", "accent"], "#fff")
    expect(new TomlDoc(doc.dumps()).get(["ui", "accent"])).toBe("#fff")
  })
})
