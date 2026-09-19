import { Predicate, Result, Schema } from "effect"

import type { PluginSettings } from "../runtime/settings.ts"
import { settingsString } from "../runtime/settings.ts"

export const TINT_KEYS = [
  "theme.custom.accent",
  "theme.custom.panel_bg",
  "theme.custom.surface_dim",
  "theme.custom.surface0",
  "theme.custom.surface1",
  "ui.accent",
] as const

export const OVERLAY_KEYS = ["theme.custom.overlay0", "theme.custom.overlay1"] as const

export const FALLBACK_BASE = "#1e1f22"

export const DEFAULT_INTENSITY = "medium"

const BASE_BY_THEME = [
  ["catppuccin", "#1e1e2e"],
  ["terminal", "#121212"],
  ["tokyo-night", "#1a1b26"],
  ["dracula", "#282a36"],
  ["nord", "#2e3440"],
  ["gruvbox", "#282828"],
  ["one-dark", "#282c34"],
  ["solarized", "#002b36"],
  ["kanagawa", "#1f1f28"],
  ["rose-pine", "#191724"],
  ["vesper", "#101010"],
] as const

const LIGHT_THEMES = [
  "catppuccin-latte",
  "tokyo-night-day",
  "rose-pine-dawn",
  "solarized-light",
  "gruvbox-light",
  "one-light",
] as const

const INTENSITY_PRESETS = [
  ["subtle", { panel_bg: 0.08, surface_dim: 0.11, surface0: 0.14, surface1: 0.20 }],
  ["medium", { panel_bg: 0.14, surface_dim: 0.19, surface0: 0.25, surface1: 0.36 }],
  ["bold", { panel_bg: 0.22, surface_dim: 0.29, surface0: 0.38, surface1: 0.52 }],
] as const

const INTENSITY_OVERLAYS = [
  ["subtle", false],
  ["medium", true],
  ["bold", true],
] as const

const LUMA_CEILING = [
  ["panel_bg", 62.0],
  ["surface_dim", 72.0],
  ["surface0", 84.0],
  ["surface1", 102.0],
] as const

export type IntensityName = "subtle" | "medium" | "bold"

export type BlendMix = {
  panel_bg: number
  surface_dim: number
  surface0: number
  surface1: number
}

export type ThemePair = readonly [string, string]

export type ThemeValues = {
  readonly pairs: readonly ThemePair[]
}

type Rgb = {
  readonly r: number
  readonly g: number
  readonly b: number
}

function intensityFromName(name: string): BlendMix | undefined {
  for (const [key, mix] of INTENSITY_PRESETS) {
    if (key === name) return { ...mix }
  }

  return undefined
}

export function intensityName(settings: PluginSettings): IntensityName {
  const raw = settings.intensity
  const text = Predicate.isString(raw) ? raw : String(raw ?? DEFAULT_INTENSITY)
  const name = text.trim().toLowerCase()

  if (name === "subtle" || name === "medium" || name === "bold") return name

  return DEFAULT_INTENSITY
}

export function resolveBlend(settings: PluginSettings): BlendMix {
  const mix = intensityFromName(intensityName(settings)) ?? intensityFromName(DEFAULT_INTENSITY)

  const resolved: BlendMix = mix === undefined
    ? { panel_bg: 0.14, surface_dim: 0.19, surface0: 0.25, surface1: 0.36 }
    : mix

  const blend = settings.blend
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(blend)

  if (Result.isFailure(decoded)) return resolved

  for (const key of ["panel_bg", "surface_dim", "surface0", "surface1"] as const) {
    const value = decoded.success[key]

    const numeric = Predicate.isNumber(value)
      ? value
      : Predicate.isString(value)
        ? Number.parseFloat(value)
        : undefined

    if (numeric === undefined || Number.isNaN(numeric)) continue

    resolved[key] = Math.max(0.0, Math.min(0.75, numeric))
  }

  return resolved
}

export function resolveOverlays(settings: PluginSettings): boolean {
  const explicit = settings.tint_overlays

  if (explicit === null || explicit === undefined) {
    const name = intensityName(settings)

    for (const [key, enabled] of INTENSITY_OVERLAYS) {
      if (key === name) return enabled
    }

    return true
  }

  return Boolean(explicit)
}

export function parseHex(value: string): Rgb {
  let hex = value.trim()

  if (hex.startsWith("#")) hex = hex.slice(1)

  if (hex.length === 3) {
    const a = hex[0]
    const b = hex[1]
    const c = hex[2]

    hex = `${a}${a}${b}${b}${c}${c}`
  }

  if (hex.length !== 6) throw new Error(`not a hex colour: ${value}`)

  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function toHex(rgb: Rgb): string {
  const channel = (value: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(value)))

    return clamped.toString(16).padStart(2, "0")
  }

  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`
}

export function luminance(hexv: string): number {
  const rgb = parseHex(hexv)

  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b
}

export function blend(base: string, target: string, amount: number): string {
  const mix = Math.max(0.0, Math.min(1.0, amount))
  const left = parseHex(base)
  const right = parseHex(target)

  return toHex({
    r: left.r + (right.r - left.r) * mix,
    g: left.g + (right.g - left.g) * mix,
    b: left.b + (right.b - left.b) * mix,
  })
}

export function lighten(colour: string, amount: number): string {
  return blend(colour, "#ffffff", amount)
}

export function blendCapped(base: string, target: string, amount: number, ceiling: number): string {
  const lb = luminance(base)
  const lt = luminance(target)
  let mix = amount

  if (lt > lb) {
    if (lb >= ceiling) return base

    mix = Math.min(amount, (ceiling - lb) / (lt - lb))
  }

  return blend(base, target, Math.max(0.0, mix))
}

export function isLightTheme(themeName: string | undefined): boolean {
  const name = (themeName ?? "").trim().toLowerCase()

  for (const light of LIGHT_THEMES) {
    if (light === name) return true
  }

  return false
}

export function resolveBase(themeName: string | undefined, settings: PluginSettings): string {
  const configured = (settingsString(settings, "theme_base") ?? "auto").trim()

  if (configured.toLowerCase() !== "auto") {
    try {
      parseHex(configured)

      return configured.toLowerCase()
    } catch {
      // doctor and tint fall back to auto when theme_base is not a hex colour
    }
  }

  const name = (themeName ?? "").trim().toLowerCase()

  for (const [family, base] of BASE_BY_THEME) {
    if (name === family) return base
  }

  for (const [family, base] of BASE_BY_THEME) {
    if (name.startsWith(family)) return base
  }

  return FALLBACK_BASE
}

function lumaCeiling(slot: "panel_bg" | "surface_dim" | "surface0" | "surface1"): number {
  for (const [key, value] of LUMA_CEILING) {
    if (key === slot) return value
  }

  return 102.0
}

export function generate(
  colour: string,
  themeName: string | undefined,
  settings: PluginSettings,
): ThemeValues {
  const base = resolveBase(themeName, settings)
  const mix = resolveBlend(settings)

  const pairs: ThemePair[] = [
    ["theme.custom.accent", colour],
    ["ui.accent", colour],
    ["theme.custom.panel_bg", blendCapped(base, colour, mix.panel_bg, lumaCeiling("panel_bg"))],
    ["theme.custom.surface_dim", blendCapped(base, colour, mix.surface_dim, lumaCeiling("surface_dim"))],
    ["theme.custom.surface0", blendCapped(base, colour, mix.surface0, lumaCeiling("surface0"))],
    ["theme.custom.surface1", blendCapped(base, colour, mix.surface1, lumaCeiling("surface1"))],
  ]

  if (resolveOverlays(settings)) {
    const strength = mix.surface1

    pairs.push([
      "theme.custom.overlay0",
      blend(lighten(base, 0.28), colour, Math.min(0.6, strength * 1.1)),
    ])
    pairs.push([
      "theme.custom.overlay1",
      blend(lighten(base, 0.38), colour, Math.min(0.7, strength * 1.3)),
    ])
  }

  return { pairs }
}

export function managedKeys(settings: PluginSettings): string[] {
  const keys: string[] = []

  for (const key of TINT_KEYS) keys.push(key)

  if (resolveOverlays(settings)) {
    for (const key of OVERLAY_KEYS) keys.push(key)
  }

  return keys
}

export function themeValue(values: ThemeValues, key: string): string | undefined {
  for (const [name, value] of values.pairs) {
    if (name === key) return value
  }

  return undefined
}
