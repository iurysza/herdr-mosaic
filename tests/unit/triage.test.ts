import { describe, expect, test } from "bun:test"

import {
  idleCycleCandidates,
  nextIdleAgent,
  parseDuration,
  pruneRows,
} from "../../src/agents/triage.ts"
import { defaultState, type PluginState } from "../../src/state/store.ts"
import type { JsonObject } from "../../src/runtime/rpc.ts"

function agent(
  paneId: string,
  status = "idle",
  focused = false,
): JsonObject {
  const record: JsonObject = {
    pane_id: paneId,
    agent_status: status,
    agent: "pi",
    terminal_title_stripped: `Task ${paneId}`,
    workspace_id: "w1",
    tab_id: "w1:t1",
  }

  if (focused) {
    return { ...record, focused: true }
  }

  return record
}

function withSettled(
  ...records: ReadonlyArray<readonly [string, string, number | null]>
): PluginState {
  const state = defaultState()

  for (const [paneId, status, settled] of records) {
    state.agent_settled[paneId] = { status, last_settled_at: settled }
  }

  return state
}

describe("parseDuration", () => {
  test("requires a positive explicit unit", () => {
    expect(parseDuration("8h")).toBe(8 * 60 * 60)
    expect(parseDuration("2D")).toBe(2 * 24 * 60 * 60)

    for (const value of [null, "", "0h", "8", "1.5h", "hour", "-1d"]) {
      expect(parseDuration(value)).toBeUndefined()
    }
  })
})

describe("idle cycle", () => {
  test("starts with newest then wraps", () => {
    const agents = [agent("p-old"), agent("p-new"), agent("p-mid")]

    const state = withSettled(
      ["p-old", "idle", 10],
      ["p-mid", "done", 20],
      ["p-new", "idle", 30],
    )

    const first = nextIdleAgent(agents, state, undefined)
    const second = nextIdleAgent(agents, state, first?.pane_id)
    const third = nextIdleAgent(agents, state, second?.pane_id)
    const fourth = nextIdleAgent(agents, state, third?.pane_id)

    expect([first?.pane_id, second?.pane_id, third?.pane_id, fourth?.pane_id]).toEqual([
      "p-new",
      "p-mid",
      "p-old",
      "p-new",
    ])
  })

  test("skips the focused agent and places untracked last", () => {
    const agents = [agent("p-current", "idle", true), agent("p-known"), agent("p-untracked")]
    const state = withSettled(["p-current", "idle", 30], ["p-known", "done", 20])

    expect(nextIdleAgent(agents, state, undefined)?.pane_id).toBe("p-known")
    expect(idleCycleCandidates(agents, state).map((item) => item.pane_id)).toEqual([
      "p-current",
      "p-known",
      "p-untracked",
    ])
  })
})

describe("prune rows", () => {
  test("are oldest first and protect the current agent", () => {
    const agents = [
      agent("p-fresh"),
      agent("p-old"),
      agent("p-current"),
      agent("p-untracked"),
      agent("p-work", "working"),
    ]

    const state = withSettled(
      ["p-fresh", "idle", 950],
      ["p-old", "done", 100],
      ["p-current", "idle", 10],
      ["p-untracked", "idle", null],
    )

    const rows = pruneRows(agents, state, 100, "p-current", 1000)

    expect(rows.map((row) => row.pane_id)).toEqual([
      "p-current",
      "p-old",
      "p-fresh",
      "p-untracked",
    ])
    expect(rows.map((row) => row.eligible)).toEqual([false, true, false, false])
    expect(rows[0]?.protected).toBe(true)
  })

  test("never marks anything eligible without a threshold", () => {
    const rows = pruneRows([agent("p1")], withSettled(["p1", "idle", 1]), undefined, undefined, 1000)

    expect(rows[0]?.eligible).toBe(false)
  })
})
