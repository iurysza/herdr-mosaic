import { describe, expect, test } from "bun:test"

import { decodeKeys, isChar, isEnter, isEscape } from "../../src/terminal/keys.ts"

describe("decodeKeys", () => {
  test("maps curses-style arrow sequences and enter", () => {
    const decoded = decodeKeys(Uint8Array.from([27, 91, 65, 27, 91, 66, 10, 13, 113]), [])

    expect(decoded.keys).toEqual([
      { type: "up" },
      { type: "down" },
      { type: "enter" },
      { type: "enter" },
      { type: "char", code: 113 },
    ])
    expect(decoded.pending).toEqual([])
  })

  test("holds a partial escape sequence until it is complete", () => {
    const first = decodeKeys(Uint8Array.from([27, 91]), [])

    expect(first.keys).toEqual([])
    expect(first.pending).toEqual([27, 91])

    const second = decodeKeys(Uint8Array.from([65]), first.pending)

    expect(second.keys).toEqual([{ type: "up" }])
    expect(second.pending).toEqual([])
  })

  test("bare escape is a cancel key", () => {
    const decoded = decodeKeys(Uint8Array.from([27, 113]), [])
    const first = decoded.keys[0]
    const second = decoded.keys[1]

    expect(first).toEqual({ type: "escape" })

    if (first !== undefined) expect(isEscape(first)).toBe(true)

    if (second !== undefined) expect(isChar(second, "q")).toBe(true)

    expect(isEnter({ type: "char", code: 10 })).toBe(true)
  })
})
