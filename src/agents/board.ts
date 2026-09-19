import { join } from "node:path"

import { Effect, Predicate } from "effect"

import { PLUGIN_ID } from "../ids.ts"
import { identityOf, load } from "../state/store.ts"
import { emptyOutput, joinOutput, pluginWarn } from "../runtime/plugin-log.ts"
import { PluginPaths } from "../runtime/paths.ts"
import {
  listAgents,
  listWorkspaces,
  rpcTryCall,
  type JsonObject,
} from "../runtime/rpc.ts"
import { isChar, isEnter, isEscape, type Key } from "../terminal/keys.ts"
import { addnstr, emptyScreen, type Screen } from "../terminal/screen.ts"
import { runRawLoop, type LoopEvent } from "../terminal/session.ts"

export type BoardGroup = {
  readonly workspace_id: string
  readonly label: string
  readonly emoji: string
  readonly agents: JsonObject[]
}

export type BoardState = {
  groups: BoardGroup[]
  collapsed: Set<string>
  cursor: number
}

export type BoardRow =
  | { readonly kind: "group"; readonly group: BoardGroup }
  | { readonly kind: "agent"; readonly group: BoardGroup; readonly agent: JsonObject }

export type BoardIntent =
  | { readonly type: "continue"; readonly state: BoardState }
  | { readonly type: "reload" }
  | { readonly type: "focus"; readonly paneId: string }
  | { readonly type: "quit" }

function statusRank(status: JsonObject[string] | undefined): number {
  if (status === "blocked") return 0

  if (status === "working") return 1

  if (status === "unknown") return 2

  if (status === "idle") return 3

  if (status === "done") return 4

  return 9
}

export function collectGroups(
  workspaces: readonly JsonObject[],
  agents: readonly JsonObject[],
  identities: ReturnType<typeof load>,
): BoardGroup[] {
  const byWs = new Map<string, JsonObject[]>()

  for (const agent of agents) {
    const workspaceId = agent.workspace_id
    const key = Predicate.isString(workspaceId) ? workspaceId : ""
    const bucket = byWs.get(key) ?? []

    bucket.push(agent)
    byWs.set(key, bucket)
  }

  const sorted = [...workspaces].sort((left, right) => {
    const ln = Predicate.isNumber(left.number) ? left.number : 0
    const rn = Predicate.isNumber(right.number) ? right.number : 0

    if (ln !== rn) return ln - rn

    const lid = Predicate.isString(left.workspace_id) ? left.workspace_id : ""
    const rid = Predicate.isString(right.workspace_id) ? right.workspace_id : ""

    if (lid < rid) return -1

    if (lid > rid) return 1

    return 0
  })

  const groups: BoardGroup[] = []

  for (const workspace of sorted) {
    const workspaceId = workspace.workspace_id

    if (!Predicate.isString(workspaceId) || workspaceId === "") continue

    const members = [...(byWs.get(workspaceId) ?? [])]

    if (members.length === 0) continue

    members.sort((left, right) => {
      const rank = statusRank(left.agent_status) - statusRank(right.agent_status)

      if (rank !== 0) return rank

      const lid = Predicate.isString(left.pane_id) ? left.pane_id : ""
      const rid = Predicate.isString(right.pane_id) ? right.pane_id : ""

      if (lid < rid) return -1

      if (lid > rid) return 1

      return 0
    })

    const info = identityOf(identities, workspaceId)
    const emojiValue = info === undefined ? undefined : info.emoji
    const label = workspace.label

    groups.push({
      workspace_id: workspaceId,
      label: Predicate.isString(label) && label !== "" ? label : workspaceId,
      emoji: Predicate.isString(emojiValue) && emojiValue !== "" ? emojiValue : "•",
      agents: members,
    })
  }

  return groups
}

export function boardSummary(group: BoardGroup): string {
  const counts = new Map<string, number>()

  for (const agent of group.agents) {
    const status = Predicate.isString(agent.agent_status) && agent.agent_status !== ""
      ? agent.agent_status
      : "unknown"

    counts.set(status, (counts.get(status) ?? 0) + 1)
  }

  const parts: string[] = []

  for (const key of ["working", "blocked", "idle", "done", "unknown"]) {
    const count = counts.get(key)

    if (count !== undefined && count > 0) parts.push(`${count} ${key}`)
  }

  return parts.join(" · ")
}

export function flattenBoard(state: BoardState): BoardRow[] {
  const out: BoardRow[] = []

  for (const group of state.groups) {
    out.push({ kind: "group", group })

    if (!state.collapsed.has(group.workspace_id)) {
      for (const agent of group.agents) out.push({ kind: "agent", group, agent })
    }
  }

  return out
}

export function handleBoardKey(state: BoardState, key: Key): BoardIntent {
  const rows = flattenBoard(state)

  if (isEscape(key)) return { type: "quit" }

  if (isChar(key, "r")) return { type: "reload" }

  if (key.type === "up" || isChar(key, "k")) {
    state.cursor = Math.max(0, state.cursor - 1)

    return { type: "continue", state }
  }

  if (key.type === "down" || isChar(key, "j")) {
    state.cursor = Math.min(Math.max(0, rows.length - 1), state.cursor + 1)

    return { type: "continue", state }
  }

  if (isEnter(key) || isChar(key, " ")) {
    const row = rows[state.cursor]

    if (row === undefined) return { type: "continue", state }

    if (row.kind === "group") {
      if (state.collapsed.has(row.group.workspace_id)) state.collapsed.delete(row.group.workspace_id)
      else state.collapsed.add(row.group.workspace_id)

      return { type: "continue", state }
    }

    const paneId = row.agent.pane_id

    if (!Predicate.isString(paneId) || paneId === "") return { type: "continue", state }

    return { type: "focus", paneId }
  }

  return { type: "continue", state }
}

export function renderBoard(state: BoardState, rows: number, cols: number): Screen {
  const screen = emptyScreen(rows, cols)
  const width = Math.max(0, cols - 2)

  addnstr(screen, 0, 1, "Workspace Agent Board", width, { bold: true })
  addnstr(screen, 1, 1, "─".repeat(width), width)

  const items = flattenBoard(state)

  if (items.length === 0) {
    addnstr(screen, 3, 2, "No agents detected.", Math.max(0, cols - 4))
  }

  const top = 2
  const avail = Math.max(1, rows - top - 1)

  state.cursor = Math.max(0, Math.min(state.cursor, Math.max(0, items.length - 1)))
  const off = Math.max(0, Math.min(state.cursor - avail + 1, Math.max(0, items.length - avail)))

  for (let i = 0; i < avail; i++) {
    const ri = i + off
    const item = items[ri]

    if (item === undefined) break

    const sel = ri === state.cursor
    const attr = sel ? { reverse: true } : {}

    if (item.kind === "group") {
      const arrow = state.collapsed.has(item.group.workspace_id) ? "▶" : "▼"
      const text = `${arrow} ${item.group.emoji} ${item.group.label}`
      const summary = boardSummary(item.group)
      const pad = Math.max(1, cols - text.length - summary.length - 4)

      addnstr(screen, top + i, 1, `${text}${" ".repeat(pad)}${summary}`, width, {
        ...attr,
        bold: true,
      })
    } else {
      const status = Predicate.isString(item.agent.agent_status) && item.agent.agent_status !== ""
        ? item.agent.agent_status
        : "unknown"

      const name = Predicate.isString(item.agent.agent) && item.agent.agent !== ""
        ? item.agent.agent
        : "agent"

      const title = Predicate.isString(item.agent.terminal_title_stripped)
        ? item.agent.terminal_title_stripped
        : ""

      const left = `    ${item.group.emoji} ${name.padEnd(10, " ")} ${status}`
      const right = title.slice(0, Math.max(0, cols - left.length - 4))

      addnstr(screen, top + i, 1, `${left}  ${right}`, width, attr)
    }
  }

  addnstr(
    screen,
    rows - 1,
    1,
    "↑↓ move  Space/Enter collapse-or-focus  r reload  q quit".slice(0, Math.max(0, cols - 2)),
    width,
    { dim: true },
  )

  return screen
}

export function dumpBoard(groups: readonly BoardGroup[]): string {
  const lines: string[] = []

  for (const group of groups) {
    lines.push(`${group.emoji} ${group.label}  (${boardSummary(group)})`)

    for (const agent of group.agents) {
      const name = Predicate.isString(agent.agent) ? agent.agent : ""
      const status = Predicate.isString(agent.agent_status) ? agent.agent_status : ""

      lines.push(`    ${name.padEnd(10, " ")} ${status}`)
    }
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`
}

const loadGroups = Effect.fnUntraced(function*(paths: { readonly stateDir: string }) {
  const workspaces = yield* listWorkspaces()
  const agents = yield* listAgents()

  return collectGroups(workspaces, agents, load(join(paths.stateDir, "state.json")))
})

export const runBoardOpen = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  const opened = yield* rpcTryCall("plugin.pane.open", {
    plugin_id: PLUGIN_ID,
    entrypoint: "board",
    focus: true,
  })

  if (opened.error !== undefined) {
    yield* pluginWarn(
      paths,
      output,
      `could not open agent board: ${opened.error.code}: ${opened.error.message}`,
    )

    return { code: 1, stdout: joinOutput(output.stdout), stderr: joinOutput(output.stderr) } as const
  }

  return { code: 0, stdout: "", stderr: "" } as const
})

export const runBoard = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const groups = yield* loadGroups(paths)

  if (argv.includes("--once")) {
    return { code: 0, stdout: dumpBoard(groups), stderr: "" } as const
  }

  const initial: BoardState = { groups, collapsed: new Set(), cursor: 0 }

  const result = yield* runRawLoop(initial, renderBoard, (state, key) =>
    Effect.gen(function*() {
      const intent = handleBoardKey(state, key)

      if (intent.type === "quit") {
        return { type: "stop", code: 0, stdout: "", stderr: "" } as const satisfies LoopEvent<BoardState>
      }

      if (intent.type === "reload") {
        state.groups = yield* loadGroups(paths)

        return { type: "continue", state } as const satisfies LoopEvent<BoardState>
      }

      if (intent.type === "focus") {
        const focused = yield* rpcTryCall("agent.focus", { pane_id: intent.paneId })

        if (focused.error !== undefined) {
          yield* rpcTryCall("agent.focus", { agent: intent.paneId })
        }

        return { type: "continue", state } as const satisfies LoopEvent<BoardState>
      }

      return { type: "continue", state: intent.state } as const satisfies LoopEvent<BoardState>
    }),
  ).pipe(
    Effect.catchTag("NotATty", () =>
      Effect.succeed({
        code: 1,
        stdout: "",
        stderr: "board could not start (not a tty); try --once\n",
      }),
    ),
  )

  return result
})
