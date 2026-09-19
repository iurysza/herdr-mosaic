import { describe, expect, test } from "bun:test"

import {
  collectGroups,
  dumpBoard,
  flattenBoard,
  handleBoardKey,
  renderBoard,
} from "../../src/agents/board.ts"
import { defaultState, setIdentity } from "../../src/state/store.ts"
import type { JsonObject } from "../../src/runtime/rpc.ts"
import { plain } from "../../src/terminal/screen.ts"

function agent(paneId: string, workspaceId: string, status: string, name = "pi"): JsonObject {
  return {
    pane_id: paneId,
    workspace_id: workspaceId,
    agent_status: status,
    agent: name,
    terminal_title_stripped: `Task ${paneId}`,
  }
}

describe("board grouping", () => {
  test("collects per-space groups and sorts agents by status then pane id", () => {
    const state = defaultState()

    setIdentity(state, "w2", "#7aa2f7", "manual")

    const groups = collectGroups(
      [
        { workspace_id: "w2", number: 2, label: "API" },
        { workspace_id: "w1", number: 1, label: "Web" },
        { workspace_id: "empty", number: 3, label: "Idle space" },
      ],
      [
        agent("w2:p2", "w2", "idle"),
        agent("w2:p1", "w2", "working"),
        agent("w1:p1", "w1", "done", "codex"),
      ],
      state,
    )

    expect(groups.map((group) => group.workspace_id)).toEqual(["w1", "w2"])
    expect(groups[1]?.agents.map((item) => item.pane_id)).toEqual(["w2:p1", "w2:p2"])
    expect(dumpBoard(groups)).toContain("• Web  (1 done)")
    expect(dumpBoard(groups)).toContain("codex      done")
    expect(dumpBoard(groups)).toContain("1 working · 1 idle")
  })

  test("space/enter collapses a group; q quits", () => {
    const groups = collectGroups(
      [{ workspace_id: "w1", number: 1, label: "Web" }],
      [agent("w1:p1", "w1", "idle")],
      defaultState(),
    )

    const state = { groups, collapsed: new Set<string>(), cursor: 0 }

    expect(flattenBoard(state).map((row) => row.kind)).toEqual(["group", "agent"])
    expect(handleBoardKey(state, { type: "char", code: " ".charCodeAt(0) }).type).toBe("continue")
    expect(state.collapsed.has("w1")).toBe(true)
    expect(flattenBoard(state).map((row) => row.kind)).toEqual(["group"])
    expect(handleBoardKey(state, { type: "char", code: "q".charCodeAt(0) })).toEqual({ type: "quit" })

    const text = plain(renderBoard(state, 24, 80))

    expect(text).toContain("Workspace Agent Board")
    expect(text).toContain("Web")
  })
})
