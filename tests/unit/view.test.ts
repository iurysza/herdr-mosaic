import { describe, expect, test } from "bun:test"

import { definition } from "../../src/agents/view.ts"
import { PLUGIN_ID } from "../../src/ids.ts"

describe("agent view definition", () => {
  test("unknown scope and sort fall back to all/spaces", () => {
    const view = definition("nope", "grouped")

    expect(view.filter).toBeUndefined()
    expect(view.label).toBe("Spaces")
    expect(view.sort[0]?.field).toBe("workspace_order")
    expect(view.source).toBe(PLUGIN_ID)
  })

  test("current/activity filter does not mention status", () => {
    for (const scope of ["all", "current"] as const) {
      for (const sort of ["activity", "spaces"] as const) {
        const text = JSON.stringify(definition(scope, sort).filter)

        expect(text).not.toContain("status")
        expect(text).not.toContain("blocked")
        expect(text).not.toContain("working")
        expect(text).not.toContain("idle")
      }
    }
  })
})
