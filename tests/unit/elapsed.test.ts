import { describe, expect, test } from "bun:test"

import {
  ELAPSED_BLANK,
  ELAPSED_PAD,
  ELAPSED_WIDTH,
  elapsedLabels,
  fitWidth,
  formatElapsed,
} from "../../src/agents/elapsed.ts"
import { titleTokens } from "../../src/agents/sidebar-publish.ts"
import { slotForColour } from "../../src/spaces/identity.ts"

describe("elapsed labels", () => {
  test("existing rounding fits three cells", () => {
    const cases: ReadonlyArray<readonly [number, string]> = [
      [0, "now"],
      [29, "now"],
      [30, fitWidth("1m")],
      [90, fitWidth("2m")],
      [3599, "60m"],
      [3600, fitWidth("1h")],
      [5400, fitWidth("2h")],
      [86400, fitWidth("1d")],
    ]

    for (const [seconds, expected] of cases) {
      expect(formatElapsed(seconds)).toBe(expected)
      expect(formatElapsed(seconds).length).toBe(ELAPSED_WIDTH)
    }
  })

  test("short values pad remaining cells with U+2800", () => {
    expect(fitWidth("2m")).toBe(`2m${ELAPSED_PAD}`)
    expect(fitWidth("2m").length).toBe(3)
    expect(fitWidth("now")).toBe("now")
    expect(fitWidth("99d")).toBe("99d")
  })

  test("old ages saturate at 99d and missing timestamps are blank", () => {
    expect(formatElapsed(99 * 86400)).toBe("99d")
    expect(formatElapsed(100 * 86400)).toBe("99d")
    expect(formatElapsed(400 * 86400)).toBe("99d")
    expect(elapsedLabels({}, ["p1"], 100)).toEqual([{ paneId: "p1", label: ELAPSED_BLANK }])
    expect(ELAPSED_BLANK).toBe(ELAPSED_PAD.repeat(ELAPSED_WIDTH))
    expect(ELAPSED_BLANK.includes(" ")).toBe(false)

    for (const value of [null, true, "12", -1]) {
      expect(elapsedLabels({ p1: { last_settled_at: value } }, ["p1"], 100)).toEqual([
        { paneId: "p1", label: ELAPSED_BLANK },
      ])
    }
  })

  test("status does not change age and future timestamps clamp to now", () => {
    for (const status of ["working", "idle", "done", "blocked", "unknown"]) {
      expect(elapsedLabels(
        { p1: { last_settled_at: 100, status } },
        ["p1"],
        220,
      )).toEqual([{ paneId: "p1", label: fitWidth("2m") }])
    }

    expect(elapsedLabels({ p1: { last_settled_at: 110 } }, ["p1"], 100)).toEqual([
      { paneId: "p1", label: "now" },
    ])
  })
})

describe("title tokens", () => {
  test("tab title fills one palette slot and clears the others", () => {
    const tokens = titleTokens(
      { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", terminal_title_stripped: "terminal" },
      { "w1:t1": "Fix auth" },
      { w1: { colour: "#7aa2f7" } },
    )

    expect(Object.keys(tokens).length).toBe(12)
    expect(tokens.title_azure).toBe("Fix auth")
    expect(Object.values(tokens).filter((value) => value !== null).length).toBe(1)
  })

  test("falls back through name fields and pane id", () => {
    for (const key of ["terminal_title_stripped", "name", "display_agent", "agent"]) {
      const tokens = titleTokens({ pane_id: "p1", [key]: "Name" }, {}, {})

      expect(Object.values(tokens).includes("Name")).toBe(true)
    }

    expect(Object.values(titleTokens({ pane_id: "p1" }, {}, {})).includes("p1")).toBe(true)
  })

  test("custom colour uses the nearest slot", () => {
    const tokens = titleTokens({ pane_id: "p1", workspace_id: "w1" }, {}, { w1: { colour: "#ff1234" } })

    expect(tokens[`title_${slotForColour("#ff1234")}`]).toBe("p1")
  })
})
