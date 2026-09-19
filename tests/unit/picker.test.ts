import { describe, expect, test } from "bun:test"

import {
  CUSTOM,
  createPicker,
  handlePickerKey,
  pickerColour,
  pickerRows,
  renderPicker,
} from "../../src/spaces/picker.ts"
import { PALETTE } from "../../src/spaces/palette.ts"
import { plain } from "../../src/terminal/screen.ts"

const azure = PALETTE.find(([name]) => name === "azure")?.[1]

describe("picker transitions", () => {
  test("palette colour lands on its row; custom hex selects the last row", () => {
    const rows = pickerRows()

    expect(rows[rows.length - 1]?.name).toBe(CUSTOM)
    expect(azure).toBe("#7aa2f7")

    const named = createPicker("w1", "agents", "●", azure)
    const custom = createPicker("w1", "agents", "●", "#ff00aa")

    expect(pickerColour(named)).toBe("#7aa2f7")
    expect(named.rows[named.index]?.name).toBe("azure")
    expect(custom.index).toBe(custom.rows.length - 1)
    expect(custom.custom).toBe("#ff00aa")
    expect(pickerColour(custom)).toBe("#ff00aa")
  })

  test("j/k wrap, enter saves a palette colour, q cancels", () => {
    const state = createPicker("w1", "agents", "●", undefined)

    expect(handlePickerKey(state, { type: "char", code: "k".charCodeAt(0) }).type).toBe("continue")
    expect(state.index).toBe(state.rows.length - 1)
    expect(handlePickerKey(state, { type: "char", code: "j".charCodeAt(0) }).type).toBe("continue")
    expect(state.index).toBe(0)

    const saved = handlePickerKey(state, { type: "enter" })

    expect(saved).toEqual({ type: "save", colour: "#eba0ac" })
    expect(handlePickerKey(state, { type: "char", code: "q".charCodeAt(0) })).toEqual({ type: "cancel" })
  })

  test("custom hex enter resolves; q is a hex character", () => {
    const state = createPicker("w1", "agents", "●", "#ff00aa")
    const prompt = handlePickerKey(state, { type: "enter" })

    expect(prompt.type).toBe("continue")
    expect(state.mode).toBe("hex")

    for (const letter of "#ff00aa") {
      expect(handlePickerKey(state, { type: "char", code: letter.charCodeAt(0) }).type).toBe("continue")
    }

    const saved = handlePickerKey(state, { type: "enter" })

    expect(saved).toEqual({ type: "save", colour: "#ff00aa" })

    state.mode = "hex"
    state.hexBuffer = ""
    handlePickerKey(state, { type: "char", code: "q".charCodeAt(0) })
    expect(state.hexBuffer).toBe("q")
    expect(state.mode).toBe("hex")
  })

  test("render lists the workspace and the custom row", () => {
    const state = createPicker("w1", "agents", "●", undefined)
    const text = plain(renderPicker(state, 24, 80))

    expect(text).toContain("Space color: agents (w1)")
    expect(text).toContain(CUSTOM)
    expect(text).toContain("q cancel")
  })
})
