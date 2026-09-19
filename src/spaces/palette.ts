export const PALETTE = [
  ["rose", "#eba0ac"],
  ["peach", "#fab387"],
  ["amber", "#e5c07b"],
  ["sage", "#a6d189"],
  ["aqua", "#7fd6c1"],
  ["cyan", "#8be9fd"],
  ["steel", "#8ca0b3"],
  ["azure", "#7aa2f7"],
  ["lavender", "#b4befe"],
  ["mauve", "#cba6f7"],
  ["orchid", "#e0a3e8"],
  ["blush", "#f5c2e7"],
] as const

export type PaletteName = (typeof PALETTE)[number][0]

export const SLOT_NAMES = PALETTE.map(([name]) => name)

export const TOKEN_PREFIX = "sd_"

export function slotToken(slotName: string): string {
  return `${TOKEN_PREFIX}${slotName}`
}

export function allSlotTokens(): string[] {
  return SLOT_NAMES.map(slotToken)
}
