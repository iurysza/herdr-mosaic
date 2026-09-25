import { describe, expect, test } from "bun:test"

import {
  eligibleAgents,
  parseDuration,
  pruneRows,
  selectEligibleAgent,
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

describe("eligible agents", () => {
  test("ranks blocked ahead of idle and done, newest first inside each timed group", () => {
    const agents = [
      agent("p-idle-new"),
      agent("p-blocked-old", "blocked"),
      agent("p-done-old"),
      agent("p-blocked-new", "blocked"),
      agent("p-work", "working"),
      agent("p-unknown", "unknown"),
    ]

    const state = withSettled(
      ["p-idle-new", "idle", 100],
      ["p-done-old", "done", 10],
      ["p-blocked-old", "blocked", 5],
      ["p-blocked-new", "blocked", 9],
    )

    state.agent_settled["p-blocked-old"] = {
      status: "blocked",
      last_settled_at: 1,
      last_blocked_at: 5,
    }
    state.agent_settled["p-blocked-new"] = {
      status: "blocked",
      last_settled_at: 1,
      last_blocked_at: 9,
    }

    expect(eligibleAgents(agents, state).map((item) => item.pane_id)).toEqual([
      "p-blocked-new",
      "p-blocked-old",
      "p-idle-new",
      "p-done-old",
    ])
    expect(selectEligibleAgent(agents, state, "newest")?.pane_id).toBe("p-blocked-new")
    expect(selectEligibleAgent(agents, state, "oldest")?.pane_id).toBe("p-done-old")
  })

  test("places missing times after timed agents and breaks ties by pane id", () => {
    const agents = [
      agent("p-b", "blocked"),
      agent("p-a", "blocked"),
      agent("p-idle-b"),
      agent("p-idle-a"),
      agent("p-tie-b", "done"),
      agent("p-tie-a", "idle"),
    ]

    const state = withSettled(
      ["p-idle-b", "idle", 4],
      ["p-tie-b", "done", 8],
      ["p-tie-a", "idle", 8],
    )

    state.agent_settled["p-b"] = { status: "blocked", last_settled_at: null, last_blocked_at: 3 }
    state.agent_settled["p-idle-a"] = { status: "idle", last_settled_at: null }

    expect(eligibleAgents(agents, state).map((item) => item.pane_id)).toEqual([
      "p-b",
      "p-a",
      "p-tie-a",
      "p-tie-b",
      "p-idle-b",
      "p-idle-a",
    ])
  })

  test("uses fresh timestamps and live membership rather than a frozen list", () => {
    const state = withSettled(["p1", "idle", 30], ["p2", "done", 20], ["p3", "idle", 10])
    const agents = [agent("p1"), agent("p2", "done", true), agent("p3")]

    state.idle_navigation_heads = { newest: '["p1","idle",30]' }
    expect(selectEligibleAgent(agents, state, "newest")?.pane_id).toBe("p3")
    state.agent_settled.p3 = { status: "idle", last_settled_at: 40 }
    expect(selectEligibleAgent(agents, state, "newest")?.pane_id).toBe("p3")
    expect(selectEligibleAgent([agent("p2", "done", true)], state, "newest")).toBeUndefined()
    expect(selectEligibleAgent([agent("p3")], state, "newest")?.pane_id).toBe("p3")
    state.idle_navigation_heads = "invalid saved progress"
    expect(selectEligibleAgent(agents, state, "newest")?.pane_id).toBe("p3")
  })

  test("live activity sequence wins over delayed status-hook timestamps", () => {
    const state = withSettled(["p1", "idle", 100], ["p2", "done", 200])

    const agents = [
      { ...agent("p1"), state_change_seq: 30 },
      { ...agent("p2", "done"), state_change_seq: 20 },
    ]

    expect(eligibleAgents(agents, state).map((item) => item.pane_id)).toEqual(["p1", "p2"])
    state.idle_navigation_heads = { oldest: '["p2","done",20]' }
    expect(selectEligibleAgent([
      { ...agent("p1"), state_change_seq: 30 },
      { ...agent("p2", "done", true), state_change_seq: 20 },
    ], state, "oldest")?.pane_id).toBe("p1")
  })

  test("skips the focused agent and stays put only without another candidate", () => {
    const newestFocused = [agent("p-new", "idle", true), agent("p-old")]
    const state = withSettled(["p-new", "idle", 30], ["p-old", "done", 10])

    expect(selectEligibleAgent(newestFocused, state, "newest")?.pane_id).toBe("p-old")
    expect(selectEligibleAgent(newestFocused, state, "oldest")?.pane_id).toBe("p-old")
    expect(selectEligibleAgent([agent("p-old", "done", true)], state, "oldest")).toBeUndefined()
    expect(selectEligibleAgent([agent("p-work", "working")], state, "newest")).toBeUndefined()
    expect(eligibleAgents([], state)).toEqual([])
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
