import { describe, expect, test } from "bun:test"

import {
  AGENT_STATUSES,
  applyLaunchToState,
  applyToState,
  forgetPane,
  launch,
  parseLaunchEvent,
  parsePaneId,
  parseStatusEvent,
  transition,
} from "../../src/agents/tracker.ts"
import { defaultState } from "../../src/state/store.ts"

describe("settled transition", () => {
  test("all five states update previous status from first occupancy", () => {
    let rec = transition(undefined, "idle", 10)

    for (const status of AGENT_STATUSES) {
      rec = transition(
        { status: rec.status, last_settled_at: rec.last_settled_at },
        status,
        10,
      )
      expect(rec.status).toBe(status)
      expect(rec.last_settled_at).toBe(10)
    }
  })

  test("working to idle and done record now", () => {
    const working = transition(undefined, "working", 1)

    expect(transition(
      { status: working.status, last_settled_at: working.last_settled_at },
      "idle",
      50,
    )).toEqual({ status: "idle", last_settled_at: 50, last_blocked_at: null })
    expect(transition(
      { status: working.status, last_settled_at: working.last_settled_at },
      "done",
      60,
    )).toEqual({ status: "done", last_settled_at: 60, last_blocked_at: null })
  })

  test("done to idle and duplicate settled keep the clock", () => {
    expect(transition({ status: "done", last_settled_at: 40 }, "idle", 99)).toEqual({
      status: "idle",
      last_settled_at: 40,
      last_blocked_at: null,
    })
    expect(transition({ status: "idle", last_settled_at: 40 }, "idle", 99).last_settled_at).toBe(40)
    expect(transition({ status: "done", last_settled_at: 40 }, "done", 99).last_settled_at).toBe(40)
  })

  test("first idle or done initialises launch and does not backfill", () => {
    expect(transition(undefined, "idle", 5)).toEqual({
      status: "idle",
      last_settled_at: 5,
      last_blocked_at: null,
    })
    expect(transition(undefined, "done", 6)).toEqual({
      status: "done",
      last_settled_at: 6,
      last_blocked_at: null,
    })
    expect(transition({}, "idle", 5).last_settled_at).toBeNull()
  })

  test("blocked and unknown are not completions", () => {
    const working = { status: "working" as const, last_settled_at: 1 }
    const blocked = transition(working, "blocked", 2)

    expect(blocked).toEqual({ status: "blocked", last_settled_at: 1, last_blocked_at: 2 })
    expect(transition(blocked, "idle", 3).last_settled_at).toBe(1)
    expect(transition(blocked, "done", 4).last_settled_at).toBe(1)

    const unknown = transition(working, "unknown", 2)

    expect(unknown).toEqual({ status: "unknown", last_settled_at: 1, last_blocked_at: null })
    expect(transition(unknown, "idle", 3).last_settled_at).toBe(1)
    expect(transition(unknown, "done", 4).last_settled_at).toBe(1)
  })

  test("working-blocked-idle is not a direct working-to-idle edge", () => {
    let rec = transition(undefined, "working", 1)

    rec = transition({ status: rec.status, last_settled_at: rec.last_settled_at }, "blocked", 2)
    rec = transition({ status: rec.status, last_settled_at: rec.last_settled_at }, "idle", 3)
    expect(rec).toEqual({ status: "idle", last_settled_at: 1, last_blocked_at: null })
  })

  test("entering blocked records the observation time without moving settlement", () => {
    const working = transition(undefined, "working", 1)
    const blocked = transition(working, "blocked", 8)

    expect(blocked).toEqual({ status: "blocked", last_settled_at: 1, last_blocked_at: 8 })
    expect(transition(blocked, "blocked", 9).last_blocked_at).toBe(8)
    expect(transition(undefined, "blocked", 4).last_blocked_at).toBeNull()
    expect(transition({ status: null, last_settled_at: 3 }, "blocked", 4).last_blocked_at).toBeNull()
  })

  test("blocked-working-idle does count", () => {
    let rec = transition(undefined, "blocked", 1)

    rec = transition({ status: rec.status, last_settled_at: rec.last_settled_at }, "working", 2)
    rec = transition({ status: rec.status, last_settled_at: rec.last_settled_at }, "idle", 9)
    expect(rec.last_settled_at).toBe(9)
  })

  test("idle to done is not a new settlement and new working keeps the clock", () => {
    expect(transition({ status: "idle", last_settled_at: 7 }, "done", 20).last_settled_at).toBe(7)

    const working = transition({ status: "idle", last_settled_at: 7 }, "working", 8)

    expect(working.last_settled_at).toBe(7)
    expect(transition(
      { status: working.status, last_settled_at: working.last_settled_at },
      "done",
      12,
    ).last_settled_at).toBe(12)
  })

  test("transition does not mutate the previous record", () => {
    const rec = { status: "working", last_settled_at: null }

    transition(rec, "idle", 3)
    expect(rec).toEqual({ status: "working", last_settled_at: null })
  })

  test("launch initialises once and does not backfill", () => {
    const first = launch(undefined, 10)

    expect(first).toEqual({ status: null, last_settled_at: 10, last_blocked_at: null })
    expect(launch({ status: first.status, last_settled_at: first.last_settled_at }, 99)).toEqual(first)
    expect(launch({ status: "idle", last_settled_at: null }, 50).last_settled_at).toBeNull()
    expect(launch({ status: "working", last_settled_at: 40 }, 50)).toEqual({
      status: "working",
      last_settled_at: 40,
      last_blocked_at: null,
    })
  })

  test("detection then status keeps launch time until completion", () => {
    let rec = launch(undefined, 10)

    rec = transition({ status: rec.status, last_settled_at: rec.last_settled_at }, "working", 11)
    expect(rec).toEqual({ status: "working", last_settled_at: 10, last_blocked_at: null })
    rec = transition({ status: rec.status, last_settled_at: rec.last_settled_at }, "idle", 20)
    expect(rec).toEqual({ status: "idle", last_settled_at: 20, last_blocked_at: null })
  })

  test("status then detection keeps status and launch time", () => {
    let rec = transition(undefined, "working", 7)

    rec = launch({ status: rec.status, last_settled_at: rec.last_settled_at }, 9)
    expect(rec).toEqual({ status: "working", last_settled_at: 7, last_blocked_at: null })
  })
})

describe("event payload parsing", () => {
  test("status requires a non-empty pane id and known agent_status", () => {
    expect(parseStatusEvent({ pane_id: "w1:p1", agent_status: "idle" })).toEqual({
      paneId: "w1:p1",
      status: "idle",
    })
    expect(parseStatusEvent({ pane_id: "", agent_status: "idle" })).toBeUndefined()
    expect(parseStatusEvent({ pane_id: "w1:p1", agent_status: "running" })).toBeUndefined()
    expect(parseStatusEvent({ pane_id: ["w1:p1"], agent_status: "idle" })).toBeUndefined()
    expect(parseStatusEvent("not-an-object")).toBeUndefined()
  })

  test("pane id can come from a nested pane object", () => {
    expect(parsePaneId({ pane: { pane_id: "w1:p1" } })).toBe("w1:p1")
    expect(parsePaneId({ pane_id: "w1:p1" })).toBe("w1:p1")
    expect(parsePaneId({})).toBeUndefined()
  })

  test("released detection is not a launch", () => {
    expect(parseLaunchEvent({ pane_id: "w1:p1" })).toBe("w1:p1")
    expect(parseLaunchEvent({ pane_id: "w1:p1", released: true })).toBeUndefined()
    expect(parseLaunchEvent({ pane_id: "w1:p1", released: false })).toBe("w1:p1")
  })
})

describe("state apply", () => {
  test("duplicate settled records skip rewrite and extras are stripped", () => {
    const state = defaultState()

    expect(applyToState(state, "w1:p1", "working", 10)).toBe(true)
    expect(applyToState(state, "w1:p1", "idle", 11)).toBe(true)
    expect(applyToState(state, "w1:p1", "idle", 99)).toBe(false)
    expect(state.agent_settled["w1:p1"]).toEqual({ status: "idle", last_settled_at: 11 })

    const blocked = defaultState()

    expect(applyToState(blocked, "w1:p9", "working", 1)).toBe(true)
    expect(applyToState(blocked, "w1:p9", "blocked", 4)).toBe(true)
    expect(blocked.agent_settled["w1:p9"]).toEqual({
      status: "blocked",
      last_settled_at: 1,
      last_blocked_at: 4,
    })
    expect(applyToState(blocked, "w1:p9", "blocked", 9)).toBe(false)

    const firstSeen = defaultState()

    expect(applyToState(firstSeen, "w1:p8", "blocked", 4)).toBe(true)
    expect(firstSeen.agent_settled["w1:p8"]).toEqual({ status: "blocked", last_settled_at: 4 })

    state.agent_settled["w1:p1"] = { status: "idle", last_settled_at: 11, extra: true }
    expect(applyLaunchToState(state, "w1:p1", 50)).toBe(true)
    expect(state.agent_settled["w1:p1"]).toEqual({ status: "idle", last_settled_at: 11 })
  })

  test("forgetPane drops occupancy only", () => {
    const state = defaultState()

    applyToState(state, "w1:p1", "working", 10)
    applyToState(state, "w1:p2", "working", 12)
    expect(forgetPane(state, "w1:p1")).toBe(true)
    expect(forgetPane(state, "missing")).toBe(false)
    expect(state.agent_settled).toEqual({
      "w1:p2": { status: "working", last_settled_at: 12 },
    })
  })
})
