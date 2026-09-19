import { join } from "node:path"

import { Effect, Predicate, Result, Schema } from "effect"

import { loadDoc } from "../config/patch.ts"
import { isMissing } from "../config/toml-edit.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginLog,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { listWorkspaces, type JsonObject } from "../runtime/rpc.ts"
import { saveSettings } from "../runtime/settings.ts"
import { dumpState, identityOf, load, save, type PluginState } from "../state/store.ts"
import { PALETTE } from "./palette.ts"
import {
  closePairs,
  colourName,
  ensureAll,
  isExactPaletteColour,
  slotForColour,
  type WorkspaceSnapshot,
} from "./identity.ts"
import { markerGlyph, workspaceFromRpc } from "./metadata.ts"
import { reapplyEverything } from "./tint.ts"

type Json = typeof Schema.Json.Type

const MARKER_PRESETS = [
  ["dot", "\u25cf"],
  ["ring", "\u25c9"],
  ["square", "\u25a0"],
  ["bar", "\u258a"],
  ["wide", "\u258a\u258a"],
  ["block", "\u2588"],
] as const

function statePath(stateDir: string): string {
  return join(stateDir, "state.json")
}

function commandResult(code: number, output: CapturedOutput) {
  return {
    code,
    stdout: joinOutput(output.stdout),
    stderr: joinOutput(output.stderr),
  } as const
}

function pythonRepr(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

function jsonObject(value: Json | undefined): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isSuccess(decoded)) return decoded.success

  return {}
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value

  return `${value}${" ".repeat(width - value.length)}`
}

function markerGlyphOf(raw: string): string {
  const key = raw.trim().toLowerCase()

  for (const [name, glyph] of MARKER_PRESETS) {
    if (name === key) return glyph
  }

  return raw
}

function announceEnabled(value: string): boolean {
  const text = value.trim().toLowerCase()

  return text === "on" || text === "true" || text === "yes" || text === "1" || text === "enable"
}

export const runMarker = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const args = argv.filter((arg) => !arg.startsWith("-"))

  if (args.length === 0) {
    output.stdout.push(`marker: ${pythonRepr(markerGlyph(paths))}`)

    for (const [name, glyph] of MARKER_PRESETS) {
      output.stdout.push(`  ${pad(name, 7)} ${glyph}`)
    }

    return commandResult(0, output)
  }

  const glyph = markerGlyphOf(args[0] ?? "")

  if (glyph.length > 8) {
    yield* pluginWarn(
      paths,
      output,
      `marker ${pythonRepr(glyph)} is too long; keep it to a couple of cells`,
    )

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    markerLocked(paths, output, glyph),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "marker: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  if (code === 0) {
    output.stdout.push(`marker: ${glyph}  (republished to every Space and Agent row)`)
  }

  return commandResult(code, output)
})

const markerLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  glyph: string,
) {
  saveSettings(paths, { marker: glyph })

  const state = load(statePath(paths.stateDir))

  yield* reapplyEverything(paths, output, state)
  save(statePath(paths.stateDir), state)

  return 0
})

export const runAnnounce = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const args = argv.filter((arg) => !arg.startsWith("-"))
  const want = args.length === 0 ? true : announceEnabled(args[0] ?? "")

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    announceLocked(paths, output, want),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "announce: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const announceLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  want: boolean,
) {
  yield* Effect.sync(() => {
    saveSettings(paths, { announce: want })
  })

  output.stdout.push(`announce: ${want ? "on" : "off"}`)

  if (!want) return 0

  const doc = loadDoc(paths.herdrConfigPath)
  const delivery = doc.get(["ui", "toast", "delivery"])

  if (!isMissing(delivery) && delivery !== "off") return 0

  const shown = isMissing(delivery) ? "unset (defaults to off)" : '"off"'

  output.stdout.push("")
  output.stdout.push(`Note: herdr's own toast delivery is ${shown}, so nothing will be`)
  output.stdout.push("shown yet. Enable it yourself (this is your setting, so the")
  output.stdout.push("plugin will not change it):")
  output.stdout.push("")
  output.stdout.push("  [ui.toast]")
  output.stdout.push('  delivery = "herdr"')
  output.stdout.push("")

  return 0
})

export const runRepalette = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const dry = argv.includes("--dry-run")

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    repaletteLocked(paths, output, dry),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "repalette: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const repaletteLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  dry: boolean,
) {
  const state = load(statePath(paths.stateDir))
  const workspaces = (yield* listWorkspaces()).map(workspaceFromRpc)
  const live = liveLabels(workspaces)
  const moves = collectMoves(state, live)

  if (moves.length === 0) {
    output.stdout.push("every Space already uses a current palette colour")

    return 0
  }

  for (const move of moves) {
    output.stdout.push(
      `  ${pad(move.workspaceId, 4)} ${pad(move.label.slice(0, 18), 18)} ${move.oldColour} -> ${move.newColour} (${move.slot})`,
    )

    if (!dry) {
      state.identities[move.workspaceId] = {
        ...jsonObject(state.identities[move.workspaceId]),
        colour: move.newColour,
        origin: "auto",
      }
    }
  }

  if (dry) {
    output.stdout.push("")
    output.stdout.push("(dry run -- nothing changed)")

    return 0
  }

  for (const [left, right, distance] of closePairs(state, workspaces)) {
    yield* pluginLog(
      paths,
      output,
      `colours for ${left} and ${right} are close (${distance.toFixed(0)}); reallocating ${right}`,
    )
    delete state.identities[right]
    ensureAll(state, workspaces)
  }

  yield* reapplyEverything(paths, output, state)
  save(statePath(paths.stateDir), state)
  output.stdout.push("")
  output.stdout.push(`remapped ${moves.length} Space(s)`)

  return 0
})

type PaletteMove = {
  readonly workspaceId: string
  readonly label: string
  readonly oldColour: string
  readonly newColour: string
  readonly slot: string
}

function liveLabels(workspaces: readonly WorkspaceSnapshot[]): Map<string, string> {
  const live = new Map<string, string>()

  for (const workspace of workspaces) {
    const id = workspace.workspace_id

    if (id === undefined || id === "") continue

    live.set(id, workspace.label && workspace.label !== "" ? workspace.label : id)
  }

  return live
}

function collectMoves(state: PluginState, live: Map<string, string>): PaletteMove[] {
  const moves: PaletteMove[] = []

  for (const workspaceId of Object.keys(state.identities).sort()) {
    const info = identityOf(state, workspaceId)
    const old = Predicate.isString(info?.colour) ? info.colour : undefined

    if (old === undefined || old === "" || isExactPaletteColour(old)) continue

    const slot = slotForColour(old)
    let next: string | undefined

    for (const [name, hex] of PALETTE) {
      if (name === slot) next = hex
    }

    if (next === undefined) continue

    moves.push({
      workspaceId,
      label: live.get(workspaceId) ?? "(closed)",
      oldColour: old,
      newColour: next,
      slot,
    })
  }

  return moves
}

export const runList = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const state = load(statePath(paths.stateDir))
  const workspaces = (yield* listWorkspaces()).map(workspaceFromRpc)
  const marker = markerGlyph(paths)
  const ordered = [...workspaces].sort((left, right) => (left.number || 0) - (right.number || 0))

  output.stdout.push("Spaces")

  for (const workspace of ordered) {
    const workspaceId = workspace.workspace_id ?? ""
    const info = identityOf(state, workspaceId) ?? {}
    const colour = Predicate.isString(info.colour) ? info.colour : undefined
    const origin = Predicate.isString(info.origin) && info.origin !== "" ? info.origin : "unassigned"
    const label = (workspace.label ?? "").slice(0, 18)
    const focused = workspace.focused ? "   <- focused" : ""

    output.stdout.push(
      `  ${pad(workspaceId, 4)} ${pad(label, 18)} ${colour === undefined ? "-" : marker} ${pad(colour === undefined ? "-" : colourName(colour), 9)} ${pad(colour ?? "", 8)} ${origin}${focused}`,
    )
  }

  output.stdout.push("")
  output.stdout.push("Palette (a Space's colour sets both its dot and its chrome tint)")

  for (const [name, hex] of PALETTE) {
    output.stdout.push(`  ${marker}  ${pad(name, 8)} ${hex}`)
  }

  output.stdout.push("")
  output.stdout.push("Any #rrggbb also works: the tint uses it exactly, and the dot")
  output.stdout.push("borrows the nearest palette slot (only palette slots can be")
  output.stdout.push("pre-styled in config, so only they have a real colour of their own).")
  output.stdout.push("")
  output.stdout.push("Set with:")
  output.stdout.push("  prefix+i                                    # picker popup")
  output.stdout.push(
    `  ${paths.pluginRoot}/dist/mosaic set-color `
      + "--workspace <id> --color <name|hex>",
  )

  return commandResult(0, output)
})

export const runState = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  output.stdout.push(dumpState(load(statePath(paths.stateDir))).trimEnd())

  return commandResult(0, output)
})
