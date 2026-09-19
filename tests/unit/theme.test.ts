import { describe, expect, test } from "bun:test"

import { PALETTE } from "../../src/spaces/identity.ts"
import {
  PROTECTED_KEYS,
  blend,
  blendCapped,
  generate,
  intensityName,
  intensityPreset,
  luminance,
  lumaCeiling,
  managedKeys,
  parseHex,
  resolveBase,
  resolveBlend,
  resolveOverlays,
  swatch,
  themeValue,
} from "../../src/spaces/theme.ts"
import { DEFAULT_SETTINGS } from "../../src/runtime/settings.ts"

describe("theme blending", () => {
  test("endpoints and midpoint", () => {
    expect(blend("#282828", "#4f8cff", 0.0)).toBe("#282828")
    expect(blend("#282828", "#4f8cff", 1.0)).toBe("#4f8cff")
    expect(blend("#000000", "#ffffff", 0.5)).toBe("#808080")
  })

  test("surfaces stay dark, ordered, and skip semantic slots", () => {
    const vals = generate("#a970ff", "gruvbox", DEFAULT_SETTINGS)
    const panel = themeValue(vals, "theme.custom.panel_bg") ?? ""
    const surface1 = themeValue(vals, "theme.custom.surface1") ?? ""

    const lum = (hex: string) => {
      const rgb = parseHex(hex)

      return rgb.r + rgb.g + rgb.b
    }

    expect(lum(panel)).toBeLessThan(3 * 90)
    expect(lum(panel)).toBeLessThan(lum(surface1))
    expect(themeValue(vals, "theme.custom.accent")).toBe("#a970ff")

    for (const colour of ["#4f8cff", "#a970ff", "#35c7c7", "#d9a441"]) {
      const generated = generate(colour, "gruvbox", DEFAULT_SETTINGS)

      for (const key of PROTECTED_KEYS) {
        expect(themeValue(generated, key)).toBeUndefined()
      }
    }
  })

  test("base lookup and explicit override", () => {
    const auto = { ...DEFAULT_SETTINGS, theme_base: "auto", blend: {} }

    expect(resolveBase("gruvbox", auto)).toBe("#282828")
    expect(resolveBase("tokyo-night", auto)).toBe("#1a1b26")
    expect(resolveBase("catppuccin-mocha", auto)).toBe("#1e1e2e")
    expect(resolveBase("something-unknown", auto)).toBe("#1e1f22")
    expect(resolveBase("gruvbox", { ...auto, theme_base: "#000000" })).toBe("#000000")
  })

  test("different spaces produce different values", () => {
    const a = generate("#7aa2f7", "gruvbox", DEFAULT_SETTINGS)
    const b = generate("#cba6f7", "gruvbox", DEFAULT_SETTINGS)

    expect(a.pairs).not.toEqual(b.pairs)

    for (const [key, value] of a.pairs) {
      expect(themeValue(b, key)).not.toBe(value)
    }
  })
})

describe("theme intensity", () => {
  test("presets are monotonic and surfaces ascend", () => {
    const order = ["subtle", "medium", "bold"] as const
    const keys = ["panel_bg", "surface_dim", "surface0", "surface1"] as const

    for (const key of keys) {
      const vals = order.map((name) => intensityPreset(name)[key])

      expect(vals).toEqual([...vals].sort((left, right) => left - right))
    }

    for (const name of order) {
      const mix = intensityPreset(name)

      expect(mix.panel_bg).toBeLessThan(mix.surface_dim)
      expect(mix.surface_dim).toBeLessThan(mix.surface0)
      expect(mix.surface0).toBeLessThan(mix.surface1)
    }
  })

  test("bold pastels hit the luminance ceiling exactly enough", () => {
    const st = { ...DEFAULT_SETTINGS, intensity: "bold", blend: {}, theme_base: "auto" }
    const lums = new Set<number>()

    for (const [, colour] of PALETTE) {
      const vals = generate(colour, "gruvbox", st)

      for (const key of ["panel_bg", "surface_dim", "surface0", "surface1"] as const) {
        const hex = themeValue(vals, `theme.custom.${key}`) ?? ""

        expect(luminance(hex)).toBeLessThanOrEqual(lumaCeiling(key) + 0.5)
      }

      lums.add(Math.round(luminance(themeValue(vals, "theme.custom.surface1") ?? "")))
    }

    const spread = Math.max(...lums) - Math.min(...lums)

    expect(spread).toBeLessThanOrEqual(2)

    const capped = blendCapped("#282828", "#f5c2e7", 0.9, 102.0)

    expect(Math.abs(luminance(capped) - 102.0)).toBeLessThanOrEqual(1.0)
    expect(blendCapped("#282828", "#4f8cff", 0.2, 102.0)).toBe(blend("#282828", "#4f8cff", 0.2))
  })

  test("overlays follow the preset unless forced", () => {
    expect(resolveOverlays({ ...DEFAULT_SETTINGS, intensity: "subtle" })).toBe(false)
    expect(resolveOverlays({ ...DEFAULT_SETTINGS, intensity: "bold" })).toBe(true)
    expect(resolveOverlays({ ...DEFAULT_SETTINGS, intensity: "bold", tint_overlays: false })).toBe(false)
    expect(resolveOverlays({ ...DEFAULT_SETTINGS, intensity: "subtle", tint_overlays: true })).toBe(true)
  })

  test("managed keys match generated keys and unknown intensity falls back", () => {
    for (const name of ["subtle", "medium", "bold"] as const) {
      const st = { ...DEFAULT_SETTINGS, intensity: name, blend: {}, theme_base: "auto" }
      const generated = new Set(generate("#4f8cff", "gruvbox", st).pairs.map(([key]) => key))

      expect(generated).toEqual(new Set(managedKeys(st)))
    }

    expect(intensityName({ ...DEFAULT_SETTINGS, intensity: "nonsense" })).toBe("medium")
    expect(resolveBlend({ ...DEFAULT_SETTINGS, intensity: "subtle", blend: { surface1: 0.5 } }).surface1).toBe(0.5)
    expect(resolveBlend({ ...DEFAULT_SETTINGS, intensity: "subtle", blend: { surface1: 0.5 } }).panel_bg).toBe(0.08)
    expect(resolveBlend({ ...DEFAULT_SETTINGS, intensity: "bold", blend: { surface1: 99 } }).surface1).toBeLessThanOrEqual(0.75)
  })

  test("swatch is a truecolor escape", () => {
    expect(swatch("#4f8cff").startsWith("\x1b[48;2;79;140;255m")).toBe(true)
  })
})
