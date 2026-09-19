import { describe, expect, test } from "bun:test"

import {
  balanced,
  insertionPlan,
  pane,
  paneIds,
  presets,
  same,
  split,
} from "../../src/panes/layouts.ts"

describe("layout trees", () => {
  test("balanced vertical contains every pane", () => {
    const tree = balanced(["p1", "p2", "p3"], "right")

    expect(paneIds(tree)).toEqual(["p1", "p2", "p3"])
    expect(tree.type).toBe("split")

    if (tree.type !== "split") return

    expect(tree.direction).toBe("right")
    expect(tree.ratio).toBeCloseTo(1 / 3)
  })

  test("presets are unique", () => {
    const choices = presets(["p1", "p2", "p3"])

    expect(choices.map((choice) => choice.name)).toEqual([
      "even-vertical",
      "even-horizontal",
      "main-left",
      "main-top",
      "tiled",
    ])

    for (let index = 0; index < choices.length; index++) {
      const choice = choices[index]

      if (choice === undefined) continue

      expect(
        choices.slice(0, index).some((other) => same(choice.tree, other.tree)),
      ).toBe(false)
    }
  })

  test("insertion plan builds parents before children", () => {
    const target = split(
      "right",
      0.6,
      pane("p1"),
      split("down", 0.5, pane("p2"), pane("p3")),
    )

    expect(insertionPlan(target)).toEqual([
      { targetId: "p1", sourceId: "p2", direction: "right", ratio: 0.6 },
      { targetId: "p2", sourceId: "p3", direction: "down", ratio: 0.5 },
    ])
  })

  test("single pane has one preset", () => {
    const choices = presets(["p1"])

    expect(choices).toHaveLength(1)
    expect(same(choices[0]?.tree ?? pane(""), pane("p1"))).toBe(true)
  })
})
