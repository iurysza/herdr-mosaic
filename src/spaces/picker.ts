import { join } from "node:path"

import { Effect, Predicate, Result, Schema } from "effect"

import { runApplyIdentity } from "./apply-identity.ts"
import { isExactPaletteColour, normaliseHex, PALETTE, resolveColour } from "./identity.ts"
import { identityOf, load } from "../state/store.ts"
import { PLUGIN_ID } from "../ids.ts"
import { emptyOutput, joinOutput, pluginWarn } from "../runtime/plugin-log.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { focusedWorkspace, listWorkspaces, rpcTryCall, type JsonObject } from "../runtime/rpc.ts"
import { markerGlyph } from "./metadata.ts"
import { resolveContextWorkspace } from "../runtime/invocation.ts"
import { isChar, isEnter, isEscape, type Key } from "../terminal/keys.ts"
import { addnstr, emptyScreen, type Screen } from "../terminal/screen.ts"
import { runRawLoop, type LoopEvent } from "../terminal/session.ts"

export const CUSTOM = "custom hex..."

export type PickerRow = {
  readonly name: string
  readonly hex: string | undefined
}

export type PickerState = {
  readonly workspaceId: string
  readonly label: string
  readonly marker: string
  readonly rows: readonly PickerRow[]
  index: number
  custom: string | undefined
  mode: "list" | "hex"
  hexBuffer: string
}

export type PickerIntent =
  | { readonly type: "continue"; readonly state: PickerState }
  | { readonly type: "cancel" }
  | { readonly type: "save"; readonly colour: string }

export function pickerRows(): PickerRow[] {
  const rows: PickerRow[] = []

  for (const [name, hex] of PALETTE) rows.push({ name, hex })

  rows.push({ name: CUSTOM, hex: undefined })

  return rows
}

export function createPicker(
  workspaceId: string,
  label: string,
  marker: string,
  currentColour: string | undefined,
): PickerState {
  const rows = pickerRows()
  let index = 0
  let custom: string | undefined

  if (currentColour !== undefined) {
    const lower = currentColour.toLowerCase()

    for (let i = 0; i < rows.length; i++) {
      const hex = rows[i]?.hex

      if (hex !== undefined && hex.toLowerCase() === lower) index = i
    }

    if (!isExactPaletteColour(currentColour)) {
      custom = normaliseHex(currentColour)
      index = rows.length - 1
    }
  }

  return {
    workspaceId,
    label,
    marker,
    rows,
    index,
    custom,
    mode: "list",
    hexBuffer: "",
  }
}

export function pickerColour(state: PickerState): string | undefined {
  const row = state.rows[state.index]

  if (row === undefined) return undefined

  return row.hex === undefined ? state.custom : row.hex
}

export function handlePickerKey(state: PickerState, key: Key): PickerIntent {
  if (state.mode === "hex") return handleHex(state, key)

  if (isEscape(key)) return { type: "cancel" }

  if (key.type === "up" || isChar(key, "k")) {
    state.index = (state.index - 1 + state.rows.length) % state.rows.length

    return { type: "continue", state }
  }

  if (key.type === "down" || isChar(key, "j")) {
    state.index = (state.index + 1) % state.rows.length

    return { type: "continue", state }
  }

  if (isEnter(key)) {
    const row = state.rows[state.index]

    if (row === undefined) return { type: "continue", state }

    if (row.hex === undefined) {
      state.mode = "hex"
      state.hexBuffer = ""

      return { type: "continue", state }
    }

    return { type: "save", colour: row.hex }
  }

  return { type: "continue", state }
}

function handleHex(state: PickerState, key: Key): PickerIntent {
  if (key.type === "escape") {
    state.mode = "list"

    return { type: "continue", state }
  }

  if (isEnter(key)) {
    const resolved = resolveColour(state.hexBuffer)

    state.mode = "list"

    if (resolved === undefined) return { type: "continue", state }

    state.custom = resolved

    return { type: "save", colour: resolved }
  }

  if (key.type === "char" && (key.code === 8 || key.code === 127)) {
    state.hexBuffer = state.hexBuffer.slice(0, -1)

    return { type: "continue", state }
  }

  if (key.type === "char" && key.code >= 32 && key.code < 127 && state.hexBuffer.length < 16) {
    state.hexBuffer += String.fromCharCode(key.code)

    return { type: "continue", state }
  }

  return { type: "continue", state }
}

export function renderPicker(state: PickerState, rows: number, cols: number): Screen {
  const screen = emptyScreen(rows, cols)
  const width = Math.max(0, cols - 2)

  addnstr(screen, 0, 1, `Space color: ${state.label} (${state.workspaceId})`, width, { bold: true })
  addnstr(screen, 1, 1, "─".repeat(width), width)

  const top = 2
  const avail = Math.max(1, rows - top - 3)
  const off = Math.max(0, Math.min(state.index - avail + 1, Math.max(0, state.rows.length - avail)))

  for (let i = 0; i < avail; i++) {
    const ri = i + off
    const row = state.rows[ri]

    if (row === undefined) break

    const sel = ri === state.index
    const mark = sel ? "> " : "  "
    const base = sel ? { reverse: true } : {}

    if (row.hex === undefined) {
      addnstr(screen, top + i, 1, `${mark}${CUSTOM} ${state.custom ?? ""}`, width, base)
    } else {
      addnstr(screen, top + i, 1, mark, 3, base)
      addnstr(screen, top + i, 4, state.marker, 2, { ...base, bold: true, fg: row.hex })
      addnstr(screen, top + i, 6, ` ${row.name.padEnd(8, " ")} ${row.hex}`, Math.max(0, cols - 8), base)
    }
  }

  const selected = pickerColour(state)

  addnstr(screen, rows - 2, 1, "Selected: ", width, { bold: true })

  if (selected !== undefined) {
    addnstr(screen, rows - 2, 11, state.marker, 2, { bold: true, fg: selected })
    addnstr(screen, rows - 2, 13, ` ${selected}`, Math.max(0, cols - 14), { bold: true })
  }

  if (state.mode === "hex") {
    addnstr(screen, rows - 2, 1, `Hex colour (#rrggbb): ${state.hexBuffer}`, width)
  }

  addnstr(screen, rows - 1, 1, "↑↓ move   Enter save   q cancel".slice(0, Math.max(0, cols - 2)), width, {
    dim: true,
  })

  return screen
}

function workspaceLabel(workspaces: readonly JsonObject[], id: string) {
  for (const workspace of workspaces) {
    if (workspace.workspace_id === id) {
      const label = workspace.label

      return Predicate.isString(label) && label !== "" ? label : id
    }
  }

  return id
}

const pickerLoop = Effect.fnUntraced(function*(state: PickerState) {
  return yield* runRawLoop(state, renderPicker, (current, key) =>
    Effect.gen(function*() {
      const intent = handlePickerKey(current, key)

      if (intent.type === "cancel") {
        return {
          type: "stop",
          code: 0,
          stdout: "cancelled\n",
          stderr: "",
        } as const satisfies LoopEvent<PickerState>
      }

      if (intent.type === "save") {
        const applied = yield* runApplyIdentity([
          "--workspace",
          current.workspaceId,
          "--colour",
          intent.colour,
        ])

        yield* rpcTryCall("popup.close", {})

        return {
          type: "stop",
          code: applied.code,
          stdout: applied.stdout,
          stderr: applied.stderr,
        } as const satisfies LoopEvent<PickerState>
      }

      return { type: "continue", state: intent.state } as const satisfies LoopEvent<PickerState>
    }),
  )
})

export const runPicker = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const target = paths.spaceIdentityTarget ?? (yield* focusedWorkspace())?.workspace_id

  if (!Predicate.isString(target) || target === "") {
    output.stderr.push("no workspace to edit")

    return { code: 1, stdout: "", stderr: joinOutput(output.stderr) } as const
  }

  const workspaces = yield* listWorkspaces()
  const current = identityOf(load(join(paths.stateDir, "state.json")), target)
  const colour = current === undefined ? undefined : current.colour

  const picker = createPicker(
    target,
    workspaceLabel(workspaces, target),
    markerGlyph(paths),
    Predicate.isString(colour) ? colour : undefined,
  )

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    output.stderr.push(
      "picker needs a terminal; run it as the plugin popup, or use:\n"
        + `  main.py set-color --workspace ${target} --color azure`,
    )

    return { code: 1, stdout: "", stderr: joinOutput(output.stderr) } as const
  }

  const result = yield* pickerLoop(picker).pipe(
    Effect.catchTag("NotATty", () =>
      Effect.succeed({
        code: 1,
        stdout: "",
        stderr: joinOutput([
          "picker needs a terminal; run it as the plugin popup, or use:\n"
            + `  main.py set-color --workspace ${target} --color azure`,
        ]),
      }),
    ),
  )

  return { code: result.code, stdout: result.stdout, stderr: result.stderr } as const
})

export const runSetIdentity = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const wid = yield* resolveContextWorkspace(paths)

  if (wid === undefined) {
    yield* pluginWarn(paths, output, "could not resolve a workspace to edit")

    return { code: 1, stdout: joinOutput(output.stdout), stderr: joinOutput(output.stderr) } as const
  }

  const env = Schema.decodeUnknownResult(Schema.JsonObject)({ SPACE_IDENTITY_TARGET: wid })

  const opened = yield* rpcTryCall("plugin.pane.open", {
    plugin_id: PLUGIN_ID,
    entrypoint: "picker",
    focus: true,
    placement: "popup",
    env: Result.isSuccess(env) ? env.success : {},
  })

  if (opened.error !== undefined) {
    yield* pluginWarn(
      paths,
      output,
      `could not open picker popup: ${opened.error.code}: ${opened.error.message}. `
        + `Use \`set-color --workspace ${wid} --color azure\` instead.`,
    )

    return { code: 1, stdout: joinOutput(output.stdout), stderr: joinOutput(output.stderr) } as const
  }

  return { code: 0, stdout: "", stderr: "" } as const
})
