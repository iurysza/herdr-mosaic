import { join } from "node:path"

import { Effect, Predicate, Result, Schema } from "effect"

import { PLUGIN_ID } from "../ids.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { listAgents, rpcTryCall, type JsonObject } from "../runtime/rpc.ts"
import { load, save, type PluginState } from "../state/store.ts"

type Json = typeof Schema.Json.Type

const SETTLED: ReadonlySet<string> = new Set(["idle", "done"])

const DURATION = /^([1-9][0-9]*)([smhdw])$/

const DURATION_SECONDS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
} as const

export type PruneRow = {
  readonly agent: JsonObject
  readonly pane_id: string
  readonly settled_at: number | null
  readonly age: number | null
  readonly eligible: boolean
  readonly protected: boolean
}

export type CloseSelectedResult = {
  readonly closed: readonly string[]
  readonly skipped: readonly string[]
  readonly failures: ReadonlyArray<readonly [string, string]>
}

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

function asObject(value: Json | undefined): JsonObject | undefined {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function paneIdOf(agent: JsonObject): string | undefined {
  const paneId = agent.pane_id

  if (!Predicate.isString(paneId) || paneId === "") return undefined

  return paneId
}

function settledAgents(agents: readonly JsonObject[]): JsonObject[] {
  const out: JsonObject[] = []

  for (const agent of agents) {
    const paneId = paneIdOf(agent)
    const status = agent.agent_status

    if (paneId !== undefined && Predicate.isString(status) && SETTLED.has(status)) {
      out.push(agent)
    }
  }

  return out
}

export function parseDuration(value: Json | undefined): number | undefined {
  if (!Predicate.isString(value)) return undefined

  const match = DURATION.exec(value.trim().toLowerCase())

  if (match === null) return undefined

  const amount = match[1]
  const unit = match[2]

  if (amount === undefined || unit === undefined) return undefined

  if (unit === "s") return Number.parseInt(amount, 10) * DURATION_SECONDS.s

  if (unit === "m") return Number.parseInt(amount, 10) * DURATION_SECONDS.m

  if (unit === "h") return Number.parseInt(amount, 10) * DURATION_SECONDS.h

  if (unit === "d") return Number.parseInt(amount, 10) * DURATION_SECONDS.d

  return Number.parseInt(amount, 10) * DURATION_SECONDS.w
}

export function settledAt(state: PluginState, paneId: string): number | undefined {
  const record = asObject(state.agent_settled[paneId])
  const value = record === undefined ? undefined : record.last_settled_at

  if (Predicate.isNumber(value) && Number.isInteger(value) && value >= 0) return value

  return undefined
}

export function idleCycleCandidates(
  agents: readonly JsonObject[],
  state: PluginState,
): JsonObject[] {
  const settled = settledAgents(agents)

  settled.sort((left, right) => {
    const leftId = paneIdOf(left) ?? ""
    const rightId = paneIdOf(right) ?? ""
    const leftObserved = settledAt(state, leftId)
    const rightObserved = settledAt(state, rightId)
    const leftMissing = leftObserved === undefined ? 1 : 0
    const rightMissing = rightObserved === undefined ? 1 : 0

    if (leftMissing !== rightMissing) return leftMissing - rightMissing

    const leftRank = -(leftObserved ?? 0)
    const rightRank = -(rightObserved ?? 0)

    if (leftRank !== rightRank) return leftRank - rightRank

    if (leftId < rightId) return -1

    if (leftId > rightId) return 1

    return 0
  })

  return settled
}

export function nextIdleAgent(
  agents: readonly JsonObject[],
  state: PluginState,
  previousPaneId: Json | undefined,
): JsonObject | undefined {
  const candidates = idleCycleCandidates(agents, state)

  if (candidates.length === 0) return undefined

  let focused: string | undefined

  for (const agent of candidates) {
    if (agent.focused === true) {
      focused = paneIdOf(agent)
      break
    }
  }

  const paneIds = candidates.map((agent) => paneIdOf(agent) ?? "")
  let start = 0

  if (Predicate.isString(previousPaneId)) {
    const index = paneIds.indexOf(previousPaneId)

    if (index >= 0) start = (index + 1) % candidates.length
  }

  for (let offset = 0; offset < candidates.length; offset++) {
    const candidate = candidates[(start + offset) % candidates.length]

    if (candidate === undefined) continue

    if (paneIdOf(candidate) !== focused) return candidate
  }

  return undefined
}

export function pruneRows(
  agents: readonly JsonObject[],
  state: PluginState,
  staleAfter: number | undefined,
  protectedPaneId: string | undefined,
  now: number,
): PruneRow[] {
  const rows: PruneRow[] = []

  for (const agent of settledAgents(agents)) {
    const paneId = paneIdOf(agent)

    if (paneId === undefined) continue

    const observed = settledAt(state, paneId)
    const age = observed === undefined ? null : Math.max(0, now - observed)

    rows.push({
      agent,
      pane_id: paneId,
      settled_at: observed ?? null,
      age,
      eligible: staleAfter !== undefined
        && age !== null
        && age >= staleAfter
        && paneId !== protectedPaneId,
      protected: paneId === protectedPaneId,
    })
  }

  rows.sort((left, right) => {
    const leftMissing = left.settled_at === null ? 1 : 0
    const rightMissing = right.settled_at === null ? 1 : 0

    if (leftMissing !== rightMissing) return leftMissing - rightMissing

    const leftTime = left.settled_at ?? 0
    const rightTime = right.settled_at ?? 0

    if (leftTime !== rightTime) return leftTime - rightTime

    if (left.pane_id < right.pane_id) return -1

    if (left.pane_id > right.pane_id) return 1

    return 0
  })

  return rows
}

function envObject(focused: string | undefined): JsonObject {
  if (focused === undefined) return {}

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)({
    MOSAIC_PRUNE_PROTECTED_PANE: focused,
  })

  if (Result.isFailure(decoded)) return {}

  return decoded.success
}

const nextIdleLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const state = load(statePath(paths.stateDir))
  const agents = yield* listAgents()
  const agent = nextIdleAgent(agents, state, state.idle_cycle_last_pane_id)

  if (agent === undefined) {
    output.stdout.push("no other idle agent is available")

    return 0
  }

  const paneId = paneIdOf(agent)

  if (paneId === undefined) {
    output.stdout.push("no other idle agent is available")

    return 0
  }

  const focused = yield* rpcTryCall("agent.focus", { target: paneId })

  if (focused.error !== undefined) {
    yield* pluginWarn(
      paths,
      output,
      `could not focus idle agent ${paneId}: ${focused.error.code}: ${focused.error.message}`,
    )

    return 1
  }

  state.idle_cycle_last_pane_id = paneId
  save(statePath(paths.stateDir), state)

  const title = agent.terminal_title_stripped

  output.stdout.push(
    `focused idle agent: ${Predicate.isString(title) && title !== "" ? title : paneId}`,
  )

  return 0
})

export const closeSelected = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  paneIds: readonly string[],
  staleAfter: number | undefined,
  protectedPaneId: string | undefined,
  now: number,
) {
  if (paneIds.length === 0) {
    const empty: CloseSelectedResult = { closed: [], skipped: [], failures: [] }

    return empty
  }

  return yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    closeSelectedLocked(paths, paneIds, staleAfter, protectedPaneId, now),
  )
})

const closeSelectedLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  paneIds: readonly string[],
  staleAfter: number | undefined,
  protectedPaneId: string | undefined,
  now: number,
) {
  const state = load(statePath(paths.stateDir))
  const current = new Map<string, PruneRow>()

  for (const row of pruneRows(yield* listAgents(), state, staleAfter, protectedPaneId, now)) {
    current.set(row.pane_id, row)
  }

  const closed: string[] = []
  const skipped: string[] = []
  const failures: Array<readonly [string, string]> = []

  for (const paneId of paneIds) {
    const row = current.get(paneId)

    if (row === undefined || !row.eligible) {
      skipped.push(paneId)
      continue
    }

    const closedPane = yield* rpcTryCall("pane.close", { pane_id: paneId })

    if (closedPane.error !== undefined) {
      failures.push([paneId, `${closedPane.error.code}: ${closedPane.error.message}`])
    } else {
      closed.push(paneId)
    }
  }

  return { closed, skipped, failures } satisfies CloseSelectedResult
})

const pruneStaleLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const agents = yield* listAgents()
  let focused: string | undefined

  for (const agent of agents) {
    if (agent.focused === true) {
      focused = paneIdOf(agent)
      break
    }
  }

  const opened = yield* rpcTryCall("plugin.pane.open", {
    plugin_id: PLUGIN_ID,
    entrypoint: "prune",
    focus: true,
    placement: "popup",
    env: envObject(focused),
  })

  if (opened.error !== undefined) {
    yield* pluginWarn(
      paths,
      output,
      `could not open stale-agent pruner: ${opened.error.code}: ${opened.error.message}`,
    )

    return 1
  }

  return 0
})

export const runNextIdleAgent = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  if (argv.length > 0) {
    yield* pluginWarn(paths, output, "usage: next-idle-agent")

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    nextIdleLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "timed out waiting for plugin lock").pipe(Effect.as(1)),
    ),
  )

  return commandResult(code, output)
})

export const runPruneStaleAgents = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  if (argv.length > 0) {
    yield* pluginWarn(paths, output, "usage: prune-stale-agents")

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    pruneStaleLocked(paths, output),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "timed out waiting for plugin lock").pipe(Effect.as(1)),
    ),
  )

  return commandResult(code, output)
})
