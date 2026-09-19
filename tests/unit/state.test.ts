import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { defaultState, load, save, SCHEMA_VERSION } from "../../src/state/store.ts"

function tempStatePath(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `mosaic-state-${label}-`)), "state.json")
}

describe("defaultState", () => {
  test("returns the frozen Python default fields", () => {
    const state = defaultState()

    expect(state.version).toBe(SCHEMA_VERSION)
    expect(state.identities).toEqual({})
    expect(state.alloc_cursor).toBe(0)
    expect(state.tint_enabled).toBe(false)
    expect(state.view_mode).toBe("all")
    expect(state.sort_mode).toBe("spaces")
    expect(state.view_installed).toBe(false)
    expect(state.sidebar_installed).toBe(false)
    expect(state.theme_backup).toBeNull()
    expect(state.sidebar_backup).toBeNull()
    expect(state.ownership_baseline).toBeNull()
    expect(state.last_written).toEqual({})
    expect(state.last_tint).toBeNull()
    expect(state.window_title_set).toBe(false)
    expect(state.keybind_installed).toBe(false)
    expect(state.keybind_key).toBeNull()
    expect(state.sort_keybind_installed).toBe(false)
    expect(state.sort_keybind_key).toBeNull()
    expect(state.idle_keybind_installed).toBe(false)
    expect(state.idle_keybind_key).toBeNull()
    expect(state.prune_keybind_installed).toBe(false)
    expect(state.prune_keybind_key).toBeNull()
    expect(state.pane_move_keybind_installed).toBe(false)
    expect(state.pane_move_keybind_key).toBeNull()
    expect(state.promote_pane_keybind_installed).toBe(false)
    expect(state.promote_pane_keybind_key).toBeNull()
    expect(state.pending_pane_move).toBeNull()
    expect(state.idle_cycle_last_pane_id).toBeNull()
    expect(state.agent_settled).toEqual({})
  })
})

describe("load", () => {
  test("missing file returns defaults", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mosaic-state-missing-")), "state.json")
    const loaded = load(path)
    const fresh = defaultState()

    expect(loaded).toEqual(fresh)
    expect(loaded.identities).not.toBe(fresh.identities)
  })

  test("unreadable path and invalid JSON return defaults", () => {
    const directory = mkdtempSync(join(tmpdir(), "mosaic-state-bad-"))
    const asDirectory = join(directory, "as-dir.json")
    mkdirSync(asDirectory)
    expect(load(asDirectory)).toEqual(defaultState())

    const invalid = join(directory, "invalid.json")
    writeFileSync(invalid, "{not json")
    expect(load(invalid)).toEqual(defaultState())

    const nonObject = join(directory, "list.json")
    writeFileSync(nonObject, "[1, 2]\n")
    expect(load(nonObject)).toEqual(defaultState())
  })

  test("merges loaded keys, keeps extras, and forces version", () => {
    const path = tempStatePath("merge")
    writeFileSync(path, JSON.stringify({
      version: 9,
      tint_enabled: true,
      future_field: { z: 1, a: 1 },
      last_written: { "ui.sidebar.spaces.rows": [["workspace"]] },
    }))

    const loaded = load(path)

    expect(loaded.version).toBe(1)
    expect(loaded.tint_enabled).toBe(true)
    expect(loaded.view_mode).toBe("all")
    expect(loaded.future_field).toEqual({ z: 1, a: 1 })
    expect(loaded.last_written).toEqual({
      "ui.sidebar.spaces.rows": [["workspace"]],
    })
  })
})

describe("save and load", () => {
  test("roundtrips sidebar_backup present false and present true with a list", () => {
    const path = tempStatePath("backup")
    const data = defaultState()
    data.sidebar_installed = true
    data.sidebar_backup = {
      keys: {
        "ui.sidebar.agents.rows": {
          present: true,
          value: [["state_icon", "workspace"]],
        },
        "ui.sidebar.spaces.rows": { present: false },
      },
      captured_unix: 1_700_000_000,
    }
    data.last_written = {
      "ui.sidebar.agents.rows": [["state_icon", "workspace"]],
    }

    save(path, data)

    const loaded = load(path)

    expect(loaded.sidebar_installed).toBe(true)
    expect(loaded.sidebar_backup).toEqual({
      keys: {
        "ui.sidebar.agents.rows": {
          present: true,
          value: [["state_icon", "workspace"]],
        },
        "ui.sidebar.spaces.rows": { present: false },
      },
      captured_unix: 1_700_000_000,
    })
    expect(loaded.last_written).toEqual({
      "ui.sidebar.agents.rows": [["state_icon", "workspace"]],
    })
  })

  test("writes pretty JSON with recursively sorted keys and a trailing newline", () => {
    const path = tempStatePath("pretty")
    const data = defaultState()
    data.keybind_key = "⌘P"
    data.sidebar_backup = {
      keys: {
        "ui.sidebar.spaces.rows": { present: false },
        "ui.sidebar.agents.rows": { present: true, value: [["agent"]] },
      },
      captured_unix: 42,
    }

    save(path, data)

    const text = readFileSync(path, "utf8")

    expect(text.endsWith("}\n")).toBe(true)
    expect(text.startsWith("{\n  ")).toBe(true)
    expect(text).toContain("⌘P")
    expect(text).not.toContain("\\u2318")
    expect(text.indexOf('"agent_settled"')).toBeLessThan(text.indexOf('"alloc_cursor"'))
    expect(text.indexOf('"captured_unix"')).toBeLessThan(text.indexOf('"keys"'))
    expect(text.indexOf('"ui.sidebar.agents.rows"')).toBeLessThan(
      text.indexOf('"ui.sidebar.spaces.rows"'),
    )

    const topKeys = [...text.matchAll(/^  "([^"]+)":/gm)].map((match) => match[1])

    expect(topKeys).toEqual([...topKeys].sort())
  })
})

describe("identity migration", () => {
  test("drops invalid identities, pops emoji, and keeps manual colours outside the palette", () => {
    const path = tempStatePath("migrate")
    writeFileSync(path, JSON.stringify({
      identities: {
        array: ["not", "an", "object"],
        empty: { colour: "", origin: "manual" },
        missing: { origin: "auto" },
        autoOutside: { colour: "#ff0000", origin: "auto" },
        unknownOrigin: { colour: "#00ff00", origin: "other" },
        emojiGone: { colour: "#7aa2f7", origin: "auto", emoji: "🚀", extra: true },
        autoCased: { colour: "#7AA2F7", origin: "auto" },
        manualOutside: { colour: "#ff00aa", origin: "manual" },
        labelOutside: { colour: "#00aaFF", origin: "label" },
      },
      identities_are: ["not-a-dict-ignored-because-this-is-another-key"],
      view_mode: "nope",
      sort_mode: "nope",
      agent_settled: ["not-a-dict"],
    }))

    const loaded = load(path)

    expect(loaded.identities).toEqual({
      emojiGone: { colour: "#7aa2f7", origin: "auto", extra: true },
      autoCased: { colour: "#7AA2F7", origin: "auto" },
      manualOutside: { colour: "#ff00aa", origin: "manual" },
      labelOutside: { colour: "#00aaFF", origin: "label" },
    })
    expect(loaded.view_mode).toBe("all")
    expect(loaded.sort_mode).toBe("spaces")
    expect(loaded.agent_settled).toEqual({})
  })

  test("legacy state without sort_mode defaults to spaces", () => {
    const path = tempStatePath("legacy-sort")

    writeFileSync(path, JSON.stringify({ version: 1, view_mode: "current", identities: {} }))

    const loaded = load(path)

    expect(loaded.view_mode).toBe("current")
    expect(loaded.sort_mode).toBe("spaces")
  })

  test("resets identities when the value is not a dict-like object", () => {
    const path = tempStatePath("identities-array")
    writeFileSync(path, JSON.stringify({
      identities: [{ colour: "#7aa2f7", origin: "auto" }],
      view_mode: "current",
      sort_mode: "activity",
    }))

    const loaded = load(path)

    expect(loaded.identities).toEqual({})
    expect(loaded.view_mode).toBe("current")
    expect(loaded.sort_mode).toBe("activity")
  })
})

describe("python after typescript", () => {
  test("python json.load reads TS-written present false and present true list values", async () => {
    const path = tempStatePath("py")
    const data = defaultState()
    data.sidebar_backup = {
      keys: {
        "ui.sidebar.spaces.rows": { present: false },
        "ui.sidebar.agents.rows": {
          present: true,
          value: [["state_icon", "workspace"]],
        },
      },
      captured_unix: 99,
    }

    save(path, data)

    const proc = Bun.spawn(
      [
        "python3",
        "-c",
        [
          "import json, sys",
          "with open(sys.argv[1], encoding='utf-8') as fh:",
          "    data = json.load(fh)",
          "keys = data['sidebar_backup']['keys']",
          "assert keys['ui.sidebar.spaces.rows']['present'] is False",
          "assert 'value' not in keys['ui.sidebar.spaces.rows']",
          "assert keys['ui.sidebar.agents.rows']['present'] is True",
          "assert keys['ui.sidebar.agents.rows']['value'] == [['state_icon', 'workspace']]",
        ].join("\n"),
        path,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      },
    )

    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited

    expect(stderr).toBe("")
    expect(code).toBe(0)
  })
})
