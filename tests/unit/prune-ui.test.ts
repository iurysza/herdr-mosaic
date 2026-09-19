import { describe, expect, test } from "bun:test"

import {
  columnHeadings,
  formatAge,
  handlePruneKey,
  pruneLine,
  renderPrune,
  type PruneState,
} from "../../src/agents/prune-ui.ts"
import type { PruneRow } from "../../src/agents/triage.ts"
import type { JsonObject } from "../../src/runtime/rpc.ts"
import { plain } from "../../src/terminal/screen.ts"

function agent(paneId: string): JsonObject {
  return {
    pane_id: paneId,
    agent_status: "idle",
    agent: "pi",
    terminal_title_stripped: "Task " + paneId,
    workspace_id: "w1",
    tab_id: "w1:t1",
  }
}

function row(eligible: boolean): PruneRow {
  return {
    agent: agent("p1"),
    pane_id: "p1",
    settled_at: null,
    age: null,
    eligible,
    protected: false,
  }
}

describe("prune layout", () => {
  test("formatAge matches the frozen labels", () => {
    expect(formatAge(null)).toBe("—")
    expect(formatAge(12)).toBe("now")
    expect(formatAge(120)).toBe("2m")
    expect(formatAge(7200)).toBe("2h")
    expect(formatAge(2 * 24 * 60 * 60)).toBe("2d")
  })

  test("rows use stable columns without eligibility text", () => {
    const headings = columnHeadings(120)

    const line = pruneLine(
      row(false),
      new Set(),
      { w1: "Agent team" },
      { "w1:t1": "Build Session Queries" },
      120,
    )

    expect(headings.indexOf("SESSION")).toBe(line.indexOf("Agent team"))
    expect(line.slice(4, 13)).toBe("        —")
    expect(line.slice(14, 21)).toBe("idle   ")
    expect(line.slice(22, 31)).toBe("pi       ")
    expect(line).not.toContain("untracked")
    expect(line).not.toContain("threshold")
  })

  test("space selects eligible rows; q quits the list", () => {
    const state: PruneState = {
      protectedPaneId: undefined,
      rows: [row(true)],
      workspaces: { w1: "Agent team" },
      tabs: { "w1:t1": "Build Session Queries" },
      cursor: 0,
      selected: new Set(),
      confirming: false,
      notice: "",
      mode: "list",
      thresholdBuffer: "",
      thresholdText: "8h",
    }

    expect(handlePruneKey(state, { type: "char", code: " ".charCodeAt(0) }).type).toBe("continue")
    expect(state.selected.has("p1")).toBe(true)
    expect(handlePruneKey(state, { type: "char", code: "q".charCodeAt(0) })).toEqual({ type: "quit" })

    const text = plain(renderPrune(state, 24, 80))

    expect(text).toContain("Prune stale agent sessions")
    expect(text).toContain("Stale after: 8h")
  })
})
