import { describe, expect, test } from "bun:test"

import {
  handlePaneMoveKey,
  paneDetails,
  renderPaneMove,
} from "../../src/panes/pane-move.ts"
import type { JsonObject } from "../../src/runtime/rpc.ts"
import { plain } from "../../src/terminal/screen.ts"

describe("pane-move confirmation UI", () => {
  test("S/T place and q cancels", () => {
    const state = {
      sourceId: "w1:p1",
      destinationId: "w2:p2",
      notice: "",
      panes: new Map<string, JsonObject>(),
      workspaceNames: {},
    }

    expect(handlePaneMoveKey(state, { type: "char", code: "s".charCodeAt(0) })).toEqual({
      type: "place",
      placement: "split",
    })
    expect(handlePaneMoveKey(state, { type: "char", code: "T".charCodeAt(0) })).toEqual({
      type: "place",
      placement: "tab",
    })
    expect(handlePaneMoveKey(state, { type: "char", code: "q".charCodeAt(0) })).toEqual({
      type: "cancel",
    })
  })

  test("render shows source and destination details", () => {
    const panes = new Map<string, JsonObject>([
      ["w1:p1", {
        pane_id: "w1:p1",
        workspace_id: "w1",
        terminal_title_stripped: "Source",
      }],
    ])

    const names = { w1: "Web" }
    const missing = paneDetails("gone", panes, names)
    const source = paneDetails("w1:p1", panes, names)

    expect(missing).toEqual(["gone", "No longer available"])
    expect(source).toEqual(["Source", "Web  ·  w1:p1"])

    const text = plain(renderPaneMove({
      sourceId: "w1:p1",
      destinationId: "gone",
      notice: "",
      panes,
      workspaceNames: names,
    }, 24, 80))

    expect(text).toContain("FROM")
    expect(text).toContain("Source")
    expect(text).toContain("No longer available")
    expect(text).toContain("Split right")
  })
})
