import { join } from "node:path"

import { Clock, Effect, Predicate, Result, Schema } from "effect"

import { closeSelected, parseDuration, pruneRows, type PruneRow } from "./triage.ts"
import { load } from "../state/store.ts"
import { loadSettings, saveSettings, settingsString } from "../runtime/settings.ts"
import { listAgents, listTabs, listWorkspaces } from "../runtime/rpc.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { emptyOutput, joinOutput } from "../runtime/plugin-log.ts"
import { isChar, isEscape, type Key } from "../terminal/keys.ts"
import { addnstr, emptyScreen, type Screen } from "../terminal/screen.ts"
import { runRawLoop, type LoopEvent } from "../terminal/session.ts"

export const SETTING = "prune_stale_after"

export type PruneState = {
  protectedPaneId: string | undefined
  rows: PruneRow[]
  workspaces: { [id: string]: string }
  tabs: { [id: string]: string }
  cursor: number
  selected: Set<string>
  confirming: boolean
  notice: string
  mode: "list" | "threshold"
  thresholdBuffer: string
  thresholdText: string
}

export type PruneIntent =
  | { readonly type: "continue"; readonly state: PruneState }
  | { readonly type: "reload" }
  | { readonly type: "confirm" }
  | { readonly type: "save-threshold"; readonly value: string }
  | { readonly type: "quit" }

export function formatAge(seconds: number | null): string {
  if (seconds === null) return "—"

  if (seconds < 60) return "now"

  if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m`

  if (seconds < 24 * 60 * 60) return `${Math.floor(seconds / (60 * 60))}h`

  return `${Math.floor(seconds / (24 * 60 * 60))}d`
}

export function columnHeadings(width: number): string {
  return `${"SEL".padStart(3, " ")} ${"AGE".padStart(9, " ")} ${"STATE".padEnd(7, " ")} ${"AGENT".padEnd(9, " ")} SESSION`
    .slice(0, Math.max(0, width - 2))
}

export function pruneLine(
  row: PruneRow,
  selected: ReadonlySet<string>,
  workspaces: { readonly [id: string]: string },
  tabs: { readonly [id: string]: string },
  width: number,
): string {
  const marker = !row.eligible ? " - " : selected.has(row.pane_id) ? "[x]" : "[ ]"
  const age = formatAge(row.age)

  const state = Predicate.isString(row.agent.agent_status) && row.agent.agent_status !== ""
    ? row.agent.agent_status
    : "unknown"

  const agent = Predicate.isString(row.agent.agent) && row.agent.agent !== ""
    ? row.agent.agent
    : "agent"

  const workspaceId = Predicate.isString(row.agent.workspace_id) ? row.agent.workspace_id : "?"
  const place = workspaces[workspaceId] ?? workspaceId
  const tabId = Predicate.isString(row.agent.tab_id) ? row.agent.tab_id : undefined

  const title = Predicate.isString(row.agent.terminal_title_stripped)
    ? row.agent.terminal_title_stripped
    : "?"

  const tab = tabId !== undefined ? (tabs[tabId] ?? title) : title

  const text =
    `${marker} ${age.padStart(9, " ")} ${state.padEnd(7, " ")} ${agent.padEnd(9, " ")} ${place} › ${tab}`

  return text.slice(0, Math.max(0, width - 2))
}

export function handlePruneKey(state: PruneState, key: Key): PruneIntent {
  if (state.mode === "threshold") return handleThreshold(state, key)

  if (state.confirming) {
    if (isEscape(key)) {
      state.confirming = false
      state.notice = "Termination cancelled."

      return { type: "continue", state }
    }

    if (isChar(key, "x")) return { type: "confirm" }

    return { type: "continue", state }
  }

  if (isEscape(key)) return { type: "quit" }

  if (key.type === "up" || isChar(key, "k")) {
    state.cursor = Math.max(0, state.cursor - 1)

    return { type: "continue", state }
  }

  if (key.type === "down" || isChar(key, "j")) {
    state.cursor = Math.min(Math.max(0, state.rows.length - 1), state.cursor + 1)

    return { type: "continue", state }
  }

  if (isChar(key, "r")) {
    state.notice = "Reloaded live agent state."

    return { type: "reload" }
  }

  if (isChar(key, "t")) {
    state.mode = "threshold"
    state.thresholdBuffer = ""

    return { type: "continue", state }
  }

  if (isChar(key, " ") && state.rows.length > 0) {
    const row = state.rows[state.cursor]

    if (row === undefined) return { type: "continue", state }

    if (row.eligible) {
      if (state.selected.has(row.pane_id)) state.selected.delete(row.pane_id)
      else state.selected.add(row.pane_id)
    } else {
      state.notice = "Only stale, observed, non-current agents can be selected."
    }

    return { type: "continue", state }
  }

  if (isChar(key, "x")) {
    if (state.selected.size > 0) {
      state.confirming = true
      state.notice = ""
    } else {
      state.notice = "Select one or more stale agents first."
    }
  }

  return { type: "continue", state }
}

function handleThreshold(state: PruneState, key: Key): PruneIntent {
  if (key.type === "escape") {
    state.mode = "list"
    state.notice = "Threshold unchanged."

    return { type: "continue", state }
  }

  if (key.type === "enter") {
    const value = state.thresholdBuffer.trim().toLowerCase()

    state.mode = "list"

    if (value === "") {
      state.notice = "Threshold unchanged."

      return { type: "continue", state }
    }

    if (parseDuration(value) === undefined) {
      state.notice = "Use a positive whole duration, for example 8h or 2d."

      return { type: "continue", state }
    }

    return { type: "save-threshold", value }
  }

  if (key.type === "char" && (key.code === 8 || key.code === 127)) {
    state.thresholdBuffer = state.thresholdBuffer.slice(0, -1)

    return { type: "continue", state }
  }

  if (key.type === "char" && key.code >= 32 && key.code < 127 && state.thresholdBuffer.length < 16) {
    state.thresholdBuffer += String.fromCharCode(key.code)
  }

  return { type: "continue", state }
}

export function renderPrune(state: PruneState, rows: number, cols: number): Screen {
  const screen = emptyScreen(rows, cols)
  const width = Math.max(0, cols - 2)

  addnstr(screen, 0, 1, "Prune stale agent sessions", width, { bold: true })
  addnstr(screen, 1, 1, `Stale after: ${state.thresholdText}  ·  idle/done only`, width, { dim: true })
  addnstr(screen, 2, 1, "─".repeat(width), width)
  addnstr(screen, 3, 1, columnHeadings(cols), width, { dim: true })

  if (state.confirming) {
    const selected = state.rows.filter((row) => state.selected.has(row.pane_id))

    addnstr(screen, 4, 2, `Close ${selected.length} selected agent pane(s)?`, Math.max(0, cols - 4), {
      bold: true,
    })
    addnstr(
      screen,
      6,
      2,
      "This stops each agent process. Pi session history stays on disk.",
      Math.max(0, cols - 4),
    )

    for (let index = 0; index < selected.length && index < Math.max(0, rows - 10); index++) {
      const row = selected[index]

      if (row === undefined) break

      addnstr(
        screen,
        8 + index,
        3,
        pruneLine(row, state.selected, state.workspaces, state.tabs, cols),
        Math.max(0, cols - 5),
      )
    }
  } else if (state.rows.length === 0) {
    addnstr(screen, 4, 2, "No idle or done agents to review.", Math.max(0, cols - 4))
  } else {
    const top = 4
    const available = Math.max(1, rows - top - 2)

    const offset = Math.max(
      0,
      Math.min(state.cursor - available + 1, Math.max(0, state.rows.length - available)),
    )

    for (let index = 0; index < available; index++) {
      const rowIndex = index + offset
      const row = state.rows[rowIndex]

      if (row === undefined) break

      addnstr(
        screen,
        top + index,
        1,
        pruneLine(row, state.selected, state.workspaces, state.tabs, cols),
        width,
        rowIndex === state.cursor ? { reverse: true } : {},
      )
    }
  }

  if (state.mode === "threshold") {
    addnstr(
      screen,
      rows - 2,
      1,
      `Stale after (for example 8h or 2d; blank cancels): ${state.thresholdBuffer}`,
      width,
    )
  } else if (state.notice !== "") {
    addnstr(screen, rows - 2, 1, state.notice, width, { bold: true })
  }

  const help = state.confirming
    ? "x confirm close  Esc cancel"
    : "↑↓/jk move  Space toggle  t threshold  x terminate  r reload  q cancel"

  addnstr(screen, rows - 1, 1, help.slice(0, Math.max(0, cols - 2)), width, { dim: true })

  return screen
}

const catalog = Effect.fnUntraced(function*() {
  const workspaces: { [id: string]: string } = {}
  const tabs: { [id: string]: string } = {}

  for (const workspace of yield* listWorkspaces()) {
    const id = workspace.workspace_id

    if (!Predicate.isString(id) || id === "") continue

    const label = workspace.label

    workspaces[id] = Predicate.isString(label) && label !== "" ? label : id

    for (const tab of yield* listTabs(id)) {
      const tabId = tab.tab_id

      if (!Predicate.isString(tabId) || tabId === "") continue

      const tabLabel = tab.label

      tabs[tabId] = Predicate.isString(tabLabel) && tabLabel !== "" ? tabLabel : tabId
    }
  }

  return { workspaces, tabs }
})

const reloadPrune = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  state: PruneState,
) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  const catalogued = yield* catalog()
  const threshold = parseDuration(settingsString(loadSettings(paths), SETTING))

  state.workspaces = catalogued.workspaces
  state.tabs = catalogued.tabs
  state.thresholdText = threshold === undefined
    ? "unset"
    : (settingsString(loadSettings(paths), SETTING) ?? "unset")
  state.rows = pruneRows(
    yield* listAgents(),
    load(join(paths.stateDir, "state.json")),
    threshold,
    state.protectedPaneId,
    now,
  )

  const live = new Set(state.rows.filter((row) => row.eligible).map((row) => row.pane_id))

  for (const paneId of state.selected) {
    if (!live.has(paneId)) state.selected.delete(paneId)
  }

  state.cursor = Math.max(0, Math.min(state.cursor, Math.max(0, state.rows.length - 1)))
})

export const runPrune = Effect.fnUntraced(function*(argv: readonly string[]) {
  const output = emptyOutput()

  if (argv.length > 0) {
    output.stderr.push("usage: prune")

    return { code: 1, stdout: "", stderr: joinOutput(output.stderr) } as const
  }

  const paths = yield* PluginPaths
  const protectedPane = paths.pruneProtectedPane

  const initial: PruneState = {
    protectedPaneId: protectedPane === "" ? undefined : protectedPane,
    rows: [],
    workspaces: {},
    tabs: {},
    cursor: 0,
    selected: new Set(),
    confirming: false,
    notice: "",
    mode: "list",
    thresholdBuffer: "",
    thresholdText: "unset",
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    output.stderr.push("prune needs a terminal; run it through the Mosaic action.")

    return { code: 1, stdout: "", stderr: joinOutput(output.stderr) } as const
  }

  yield* reloadPrune(paths, initial)

  const result = yield* runRawLoop(initial, renderPrune, (state, key) =>
    Effect.gen(function*() {
      const intent = handlePruneKey(state, key)

      if (intent.type === "quit") {
        return { type: "stop", code: 0, stdout: "", stderr: "" } as const satisfies LoopEvent<PruneState>
      }

      if (intent.type === "reload") {
        yield* reloadPrune(paths, state)

        return { type: "continue", state } as const satisfies LoopEvent<PruneState>
      }

      if (intent.type === "save-threshold") {
        const decoded = Schema.decodeUnknownResult(Schema.JsonObject)({
          prune_stale_after: intent.value,
        })

        if (Result.isSuccess(decoded)) saveSettings(paths, decoded.success)

        state.notice = `Stale threshold set to ${intent.value}.`
        yield* reloadPrune(paths, state)

        return { type: "continue", state } as const satisfies LoopEvent<PruneState>
      }

      if (intent.type === "confirm") {
        const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)

        const selected = state.rows
          .filter((row) => state.selected.has(row.pane_id))
          .map((row) => row.pane_id)

        const closed = yield* closeSelected(
          paths,
          selected,
          parseDuration(settingsString(loadSettings(paths), SETTING)),
          state.protectedPaneId,
          now,
        )

        const parts: string[] = []

        if (closed.closed.length > 0) parts.push(`closed ${closed.closed.length}`)

        if (closed.skipped.length > 0) parts.push(`skipped ${closed.skipped.length} changed`)

        if (closed.failures.length > 0) parts.push(`failed ${closed.failures.length}`)

        state.notice = parts.length === 0 ? "Nothing closed." : parts.join("; ")
        state.confirming = false
        state.selected.clear()
        yield* reloadPrune(paths, state)

        return { type: "continue", state } as const satisfies LoopEvent<PruneState>
      }

      return { type: "continue", state: intent.state } as const satisfies LoopEvent<PruneState>
    }),
  ).pipe(
    Effect.catchTag("NotATty", () =>
      Effect.succeed({
        code: 1,
        stdout: "",
        stderr: "prune needs a terminal; run it through the Mosaic action.\n",
      }),
    ),
  )

  return result
})
