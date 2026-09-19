import { Predicate, Result, Schema } from "effect"

import type { PluginState } from "../state/store.ts"
import { PALETTE, SLOT_NAMES, paletteHex } from "./palette.ts"

type Json = typeof Schema.Json.Type

type JsonObject = typeof Schema.JsonObject.Type

export { DEFAULT_MARKER, PALETTE, SLOT_NAMES, allSlotTokens, slotToken } from "./palette.ts"

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export const CLOSE_ENOUGH = 80.0

export type WorkspaceSnapshot = {
  readonly workspace_id?: string
  readonly number?: number
  readonly label?: string
  readonly focused?: boolean
}

export type IdentityAssignment = {
  colour: string
  origin: string
}

type Rgb = {
  readonly r: number
  readonly g: number
  readonly b: number
}

export function normaliseHex(value: string): string | undefined {
  const trimmed = value.trim()

  if (!HEX_RE.test(trimmed)) return undefined

  const lower = trimmed.toLowerCase()

  if (lower.length === 4) {
    return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
  }

  return lower
}

export function resolveColour(value: string): string | undefined {
  const named = paletteHex(value.trim().toLowerCase())

  if (named !== undefined) return named

  return normaliseHex(value)
}

function rgb(hexv: string): Rgb {
  const v = hexv.replace("#", "")

  return {
    r: Number.parseInt(v.slice(0, 2), 16),
    g: Number.parseInt(v.slice(2, 4), 16),
    b: Number.parseInt(v.slice(4, 6), 16),
  }
}

export function slotForColour(colour: string): string {
  const target = normaliseHex(colour)
  const fallback = SLOT_NAMES[0] ?? "rose"

  if (target === undefined) return fallback

  for (const [name, hexv] of PALETTE) {
    if (hexv === target) return name
  }

  const wanted = rgb(target)
  let best = fallback
  let bestD: number | undefined

  for (const [name, hexv] of PALETTE) {
    const sample = rgb(hexv)

    const d = 2 * (sample.r - wanted.r) ** 2
      + 4 * (sample.g - wanted.g) ** 2
      + 3 * (sample.b - wanted.b) ** 2

    if (bestD === undefined || d < bestD) {
      best = name
      bestD = d
    }
  }

  return best
}

export function isExactPaletteColour(colour: string): boolean {
  const target = normaliseHex(colour)

  if (target === undefined) return false

  for (const [, hexv] of PALETTE) {
    if (hexv === target) return true
  }

  return false
}

export function colourName(colour: string): string {
  const target = normaliseHex(colour)

  for (const [name, hexv] of PALETTE) {
    if (hexv === target) return name
  }

  return target ?? "?"
}

export function distance(a: string, b: string): number {
  const ah = normaliseHex(a)
  const bh = normaliseHex(b)

  if (ah === undefined || bh === undefined) return 0.0

  const left = rgb(ah)
  const right = rgb(bh)
  const rm = (left.r + right.r) / 2.0

  return Math.sqrt(
    (2 + rm / 256.0) * (left.r - right.r) ** 2
      + 4 * (left.g - right.g) ** 2
      + (2 + (255 - rm) / 256.0) * (left.b - right.b) ** 2,
  )
}

function workspaceIdOf(workspace: WorkspaceSnapshot): string {
  return workspace.workspace_id ?? ""
}

function ordered(workspaces: readonly WorkspaceSnapshot[]): WorkspaceSnapshot[] {
  return [...workspaces].sort((left, right) => {
    const ln = left.number || 0
    const rn = right.number || 0

    if (ln !== rn) return ln - rn

    const lid = workspaceIdOf(left)
    const rid = workspaceIdOf(right)

    if (lid < rid) return -1

    if (lid > rid) return 1

    return 0
  })
}

function asJsonObject(value: Json): JsonObject | undefined {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function identityColour(identities: PluginState["identities"], workspaceId: string): string | undefined {
  const raw = identities[workspaceId]

  if (raw === undefined) return undefined

  const info = asJsonObject(raw)

  if (info === undefined) return undefined

  const colour = info.colour

  if (!Predicate.isString(colour) || colour === "") return undefined

  return colour
}

function neighbourColours(
  workspaces: readonly WorkspaceSnapshot[],
  identities: PluginState["identities"],
  workspaceId: string,
): Set<string> {
  const order = ordered(workspaces).map(workspaceIdOf)
  const index = order.indexOf(workspaceId)

  if (index < 0) return new Set()

  const out = new Set<string>()

  for (const j of [index - 1, index + 1]) {
    const neighbourId = order[j]

    if (neighbourId === undefined) continue

    const colour = identityColour(identities, neighbourId)

    if (colour !== undefined) out.add(colour.toLowerCase())
  }

  return out
}

export function allocate(
  state: PluginState,
  workspaceId: string,
  workspaces: readonly WorkspaceSnapshot[],
): IdentityAssignment {
  const identities = state.identities
  const live = new Set<string>()

  for (const workspace of workspaces) {
    const id = workspaceIdOf(workspace)

    if (id !== "") live.add(id)
  }

  const adjacent = neighbourColours(workspaces, identities, workspaceId)
  const inUse: string[] = []

  for (const wid of Object.keys(identities)) {
    if (wid === workspaceId || !live.has(wid)) continue

    const colour = identityColour(identities, wid)

    if (colour !== undefined) inUse.push(colour.toLowerCase())
  }

  let bestHex: string = PALETTE[0]?.[1] ?? "#eba0ac"
  let bestScore: number | undefined

  for (let index = 0; index < PALETTE.length; index++) {
    const entry = PALETTE[index]

    if (entry === undefined) continue

    const hexv = entry[1]
    let score: number

    if (inUse.length === 0 && adjacent.size === 0) {
      score = 1e9 - index
    } else {
      const dAll = minDistance(hexv, inUse, 1e6)
      const dAdj = minDistance(hexv, adjacent, 1e6)

      score = adjacent.size > 0 ? Math.min(dAll, dAdj * 0.5) : dAll
    }

    if (bestScore === undefined || score > bestScore) {
      bestScore = score
      bestHex = hexv
    }
  }

  const cursor = Number(state.alloc_cursor) || 0

  state.alloc_cursor = (Math.trunc(cursor) + 1) % PALETTE.length

  return { colour: bestHex, origin: "auto" }
}

function minDistance(
  hexv: string,
  colours: Iterable<string>,
  empty: number,
): number {
  let best: number | undefined

  for (const colour of colours) {
    const d = distance(hexv, colour)

    if (best === undefined || d < best) best = d
  }

  return best ?? empty
}

export type ClosePair = readonly [string, string, number]

export function closePairs(
  state: PluginState,
  workspaces: readonly WorkspaceSnapshot[],
): ClosePair[] {
  const identities = state.identities
  const live = ordered(workspaces).map(workspaceIdOf)
  const out: ClosePair[] = []

  for (let i = 0; i < live.length; i++) {
    const a = live[i]

    if (a === undefined || a === "") continue

    for (let j = i + 1; j < live.length; j++) {
      const b = live[j]

      if (b === undefined || b === "") continue

      const ca = identityColour(identities, a)
      const cb = identityColour(identities, b)

      if (ca === undefined || cb === undefined) continue

      const d = distance(ca, cb)

      if (d < CLOSE_ENOUGH) out.push([a, b, d])
    }
  }

  return out.sort((left, right) => left[2] - right[2])
}

export function ensureAll(
  state: PluginState,
  workspaces: readonly WorkspaceSnapshot[],
): string[] {
  const added: string[] = []

  for (const workspace of ordered(workspaces)) {
    const wid = workspace.workspace_id

    if (wid === undefined || wid === "") continue

    const raw = state.identities[wid]
    const existing = raw === undefined ? undefined : asJsonObject(raw)

    if (existing !== undefined) {
      const colour = existing.colour

      if (Predicate.isString(colour) && colour !== "") continue

      const assigned = allocate(state, wid, workspaces)

      state.identities[wid] = { ...existing, colour: assigned.colour, origin: assigned.origin }
      continue
    }

    state.identities[wid] = allocate(state, wid, workspaces)
    added.push(wid)
  }

  return added
}
