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

export type EligibleEnd = "newest" | "oldest"

function blockedAt(state: PluginState, paneId: string): number | undefined {
  const record = asObject(state.agent_settled[paneId])
  const value = record === undefined ? undefined : record.last_blocked_at

  if (Predicate.isNumber(value) && Number.isInteger(value) && value >= 0) return value

  return undefined
}

function activitySequence(agent: JsonObject): number | undefined {
  const value = agent.state_change_seq

  if (Predicate.isNumber(value) && Number.isSafeInteger(value) && value >= 0) return value

  return undefined
}

function comparePaneId(left: string, right: string): number {
  if (left < right) return -1

  if (left > right) return 1

  return 0
}

function eligibilityGroup(
  status: string,
  blocked: number | undefined,
  settled: number | undefined,
): number | undefined {
  if (status === "blocked") return blocked === undefined ? 1 : 0

  if (SETTLED.has(status)) return settled === undefined ? 3 : 2

  return undefined
}

export function eligibleAgents(
  agents: readonly JsonObject[],
  state: PluginState,
): JsonObject[] {
  const ranked: Array<{
    readonly agent: JsonObject
    readonly group: number
    readonly time: number
    readonly paneId: string
  }> = []

  // Sequence numbers share a clock; do not compare them with wall-clock timestamps.
  const useSequences = agents.every((agent) => activitySequence(agent) !== undefined)

  for (const agent of agents) {
    const paneId = paneIdOf(agent)
    const status = agent.agent_status

    if (paneId === undefined || !Predicate.isString(status)) continue

    const blocked = useSequences ? activitySequence(agent) : blockedAt(state, paneId)
    const settled = useSequences ? activitySequence(agent) : settledAt(state, paneId)
    const group = eligibilityGroup(status, blocked, settled)

    if (group === undefined) continue

    ranked.push({
      agent,
      group,
      time: group === 0 ? blocked ?? 0 : settled ?? 0,
      paneId,
    })
  }

  ranked.sort((left, right) => {
    if (left.group !== right.group) return left.group - right.group

    if ((left.group === 0 || left.group === 2) && left.time !== right.time) {
      return right.time - left.time
    }

    return comparePaneId(left.paneId, right.paneId)
  })

  return ranked.map((row) => row.agent)
}

function activityStamp(agent: JsonObject, state: PluginState): string {
  const paneId = paneIdOf(agent) ?? ""

  const observed = agent.agent_status === "blocked"
    ? blockedAt(state, paneId)
    : settledAt(state, paneId)

  return JSON.stringify([paneId, agent.agent_status, activitySequence(agent) ?? observed ?? null])
}

function eligibleStep(agents: readonly JsonObject[], state: PluginState, end: EligibleEnd) {
  const ranked = eligibleAgents(agents, state)
  const ordered = end === "newest" ? ranked : ranked.toReversed()
  const first = ordered[0]

  if (first === undefined) return undefined

  const head = activityStamp(first, state)
  const focused = ordered.findIndex((agent) => agent.focused === true)
  const previousHeads = asObject(state.idle_navigation_heads)
  const previousHead = previousHeads?.[end]

  // A new front wins immediately. Otherwise advance from live focus, not a saved index.
  const index = previousHead !== head && first.focused !== true
    ? 0
    : (focused + 1) % ordered.length

  const chosen = ordered[index]

  if (chosen === undefined || chosen.focused === true) return undefined

  return { chosen, head }
}

export function selectEligibleAgent(
  agents: readonly JsonObject[],
  state: PluginState,
  end: EligibleEnd,
): JsonObject | undefined {
  return eligibleStep(agents, state, end)?.chosen
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

const focusEligibleLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  end: EligibleEnd,
) {
  const state = load(statePath(paths.stateDir))
  const agents = yield* listAgents()
  const step = eligibleStep(agents, state, end)
  const label = `${end}-first`

  if (step === undefined) {
    output.stdout.push("no other eligible agent is available")

    return 0
  }

  const { chosen, head } = step
  const paneId = paneIdOf(chosen)

  if (paneId === undefined) {
    output.stdout.push("no eligible agent is available")

    return 0
  }

  const focused = yield* rpcTryCall("agent.focus", { target: paneId })

  if (focused.error !== undefined) {
    yield* pluginWarn(
      paths,
      output,
      `could not focus ${label} eligible agent ${paneId}: ${focused.error.code}: ${focused.error.message}`,
    )

    return 1
  }

  state.idle_navigation_heads = { ...asObject(state.idle_navigation_heads), [end]: head }
  save(statePath(paths.stateDir), state)

  const title = chosen.terminal_title_stripped

  output.stdout.push(
    `focused next eligible agent (${label}): ${Predicate.isString(title) && title !== "" ? title : paneId}`,
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

const runEligibleAgent = Effect.fnUntraced(function*(
  argv: readonly string[],
  command: string,
  end: EligibleEnd,
) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  if (argv.length > 0) {
    yield* pluginWarn(paths, output, `usage: ${command}`)

    return commandResult(1, output)
  }

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    focusEligibleLocked(paths, output, end),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "timed out waiting for plugin lock").pipe(Effect.as(1)),
    ),
  )

  return commandResult(code, output)
})

export const runNextIdleAgent = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runEligibleAgent(argv, "next-idle-agent", "newest")
})

export const runOldestIdleAgent = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runEligibleAgent(argv, "oldest-idle-agent", "oldest")
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
