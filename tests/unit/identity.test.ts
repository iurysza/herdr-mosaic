import { describe, expect, test } from "bun:test"

import {
  PALETTE,
  SLOT_NAMES,
  allSlotTokens,
  closePairs,
  colourName,
  distance,
  ensureAll,
  isExactPaletteColour,
  resolveColour,
  slotForColour,
  slotToken,
} from "../../src/spaces/identity.ts"
import { luminance } from "../../src/spaces/theme.ts"
import { defaultState, identityOf, setIdentity } from "../../src/state/store.ts"

function workspaces(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    workspace_id: `w${i + 1}`,
    number: i + 1,
  }))
}

describe("identity", () => {
  test("default allocation is deterministic", () => {
    const a = defaultState()
    const b = defaultState()
    const ws = workspaces(5)

    ensureAll(a, ws)
    ensureAll(b, ws)
    expect(a.identities).toEqual(b.identities)
  })

  test("adjacent spaces get different colours", () => {
    const st = defaultState()

    ensureAll(st, workspaces(10))

    const cols = Array.from({ length: 10 }, (_, i) => {
      const info = identityOf(st, `w${i + 1}`)

      return info?.colour
    })

    for (let i = 0; i < cols.length - 1; i++) {
      expect(cols[i]).not.toBe(cols[i + 1])
    }
  })

  test("palette slots and hexes are distinct", () => {
    expect(SLOT_NAMES.length).toBe(new Set(SLOT_NAMES).size)
    expect(PALETTE.map(([, hex]) => hex).length).toBe(
      new Set(PALETTE.map(([, hex]) => hex)).size,
    )
    expect(PALETTE.length).toBe(12)

    for (const [, hex] of PALETTE) {
      const luma = luminance(hex)

      expect(luma).toBeGreaterThanOrEqual(150)
      expect(luma).toBeLessThanOrEqual(215)
    }
  })

  test("slot tokens are valid metadata names", () => {
    for (const tok of allSlotTokens()) {
      expect(tok).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
      expect(tok.startsWith("sd_")).toBe(true)
    }

    expect(slotToken("azure")).toBe("sd_azure")
  })

  test("exact palette colour maps to its own slot", () => {
    for (const [name, hexv] of PALETTE) {
      expect(slotForColour(hexv)).toBe(name)
    }
  })

  test("custom hex borrows the nearest slot", () => {
    expect(isExactPaletteColour("#ff00aa")).toBe(false)
    expect(SLOT_NAMES.some((name) => name === slotForColour("#ff00aa"))).toBe(true)
  })

  test("allocated identity has no emoji field", () => {
    const st = defaultState()

    ensureAll(st, workspaces(3))

    for (const workspaceId of Object.keys(st.identities)) {
      const info = identityOf(st, workspaceId)

      expect(info).toBeDefined()
      expect(Object.hasOwn(info ?? {}, "emoji")).toBe(false)
      expect(info?.colour).not.toBeUndefined()
    }
  })

  test("palette stays clear of gruvbox status colours", () => {
    for (const status of ["#fb4934", "#b8bb26", "#fabd2f"]) {
      for (const [name, hexv] of PALETTE) {
        expect(distance(hexv, status), `${name} too close to ${status}`).toBeGreaterThan(110)
      }
    }
  })

  test("allocation maximises distance from neighbours", () => {
    const st = defaultState()
    const ws = workspaces(6)

    ensureAll(st, ws)
    expect(closePairs(st, ws)).toEqual([])
  })

  test("close pairs detects similar colours", () => {
    const st = defaultState()

    setIdentity(st, "w1", "#cba6f7")
    setIdentity(st, "w2", "#e0a3e8")
    expect(closePairs(st, workspaces(2)).length).toBeGreaterThan(0)
  })

  test("identity is stable across rename", () => {
    const st = defaultState()

    ensureAll(st, [{ workspace_id: "w4", number: 1, label: "Website" }])
    const before = { ...identityOf(st, "w4") }

    ensureAll(st, [{ workspace_id: "w4", number: 1, label: "Marketing Site" }])
    expect(identityOf(st, "w4")).toEqual(before)
  })

  test("ensureAll is idempotent", () => {
    const st = defaultState()
    const ws = workspaces(4)
    const first = ensureAll(st, ws)
    const second = ensureAll(st, ws)

    expect(first).toEqual(["w1", "w2", "w3", "w4"])
    expect(second).toEqual([])
  })

  test("manual identity is not overwritten", () => {
    const st = defaultState()

    setIdentity(st, "w1", "#a970ff", "manual")
    ensureAll(st, workspaces(3))
    expect(identityOf(st, "w1")?.colour).toBe("#a970ff")
  })

  test("resolveColour accepts names, hex, and short hex", () => {
    expect(resolveColour("azure")).toBe("#7aa2f7")
    expect(resolveColour("#ABCDEF")).toBe("#abcdef")
    expect(resolveColour("#abc")).toBe("#aabbcc")
    expect(resolveColour("not-a-colour")).toBeUndefined()
    expect(resolveColour("#12345")).toBeUndefined()
    expect(colourName("#7aa2f7")).toBe("azure")
    expect(colourName("#ff00aa")).toBe("#ff00aa")
    expect(colourName("nope")).toBe("?")
  })

  test("legacy colour-less identity is filled without adding a new id", () => {
    const st = defaultState()

    st.identities = { w1: { origin: "auto" } }
    const added = ensureAll(st, workspaces(1))

    expect(added).toEqual([])
    expect(identityOf(st, "w1")?.colour).toEqual(expect.any(String))
    expect(identityOf(st, "w1")?.origin).toBe("auto")
  })
})
