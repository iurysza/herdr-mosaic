import { Predicate, Result, Schema } from "effect"

import type { PluginState } from "../state/store.ts"

type Json = typeof Schema.Json.Type

type JsonObject = typeof Schema.JsonObject.Type

export const AGENT_STATUSES = ["idle", "working", "blocked", "done", "unknown"] as const

export type AgentStatus = (typeof AGENT_STATUSES)[number]

const STATUS_SET: ReadonlySet<string> = new Set(AGENT_STATUSES)

const SETTLED: ReadonlySet<string> = new Set(["idle", "done"])

export type SettledRecord = {
  readonly status: AgentStatus | null
  readonly last_settled_at: number | null
  readonly last_blocked_at: number | null
}

export type StatusEvent = {
  readonly paneId: string
  readonly status: AgentStatus
}

function asObject(value: Json | undefined): JsonObject | undefined {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function timestamp(raw: Json | undefined): number | null {
  if (Predicate.isNumber(raw) && Number.isInteger(raw) && raw >= 0) return raw

  return null
}

function isAgentStatus(value: Json | undefined): value is AgentStatus {
  return Predicate.isString(value) && STATUS_SET.has(value)
}

function nonEmptyId(value: Json | undefined): string | undefined {
  if (!Predicate.isString(value) || value.trim() === "") return undefined

  return value
}

function settledJson(record: SettledRecord): JsonObject {
  const payload = record.last_blocked_at === null
    ? {
      status: record.status,
      last_settled_at: record.last_settled_at,
    }
    : {
      status: record.status,
      last_settled_at: record.last_settled_at,
      last_blocked_at: record.last_blocked_at,
    }

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(payload)

  if (Result.isFailure(decoded)) return { status: null, last_settled_at: null }

  return decoded.success
}

function sameSettled(stored: Json | undefined, next: SettledRecord): boolean {
  const object = asObject(stored)

  if (object === undefined) return false

  for (const key of Object.keys(object)) {
    if (key !== "status" && key !== "last_settled_at" && key !== "last_blocked_at") return false
  }

  return object.status === next.status
    && object.last_settled_at === next.last_settled_at
    && timestamp(object.last_blocked_at) === next.last_blocked_at
}

export function parseStatusEvent(data: Json): StatusEvent | undefined {
  const object = asObject(data)

  if (object === undefined) return undefined

  const paneId = nonEmptyId(object.pane_id)
  const status = object.agent_status

  if (paneId === undefined || !isAgentStatus(status)) return undefined

  return { paneId, status }
}

export function parsePaneId(data: Json): string | undefined {
  const object = asObject(data)

  if (object === undefined) return undefined

  const direct = nonEmptyId(object.pane_id)

  if (direct !== undefined) return direct

  const pane = asObject(object.pane)

  if (pane === undefined) return undefined

  return nonEmptyId(pane.pane_id)
}

export function parseLaunchEvent(data: Json): string | undefined {
  const object = asObject(data)

  if (object === undefined || object.released === true) return undefined

  return parsePaneId(object)
}

export function launch(previous: Json | undefined, now: number): SettledRecord {
  const object = asObject(previous)

  if (object === undefined) {
    return { status: null, last_settled_at: now, last_blocked_at: null }
  }

  return {
    status: isAgentStatus(object.status) ? object.status : null,
    last_settled_at: timestamp(object.last_settled_at),
    last_blocked_at: timestamp(object.last_blocked_at),
  }
}

export function transition(
  previous: Json | undefined,
  status: AgentStatus,
  now: number,
): SettledRecord {
  const object = asObject(previous)
  let lastSettledAt: number | null = now
  let lastBlockedAt: number | null = null
  let prevStatus: Json | undefined

  if (object !== undefined) {
    prevStatus = object.status
    lastSettledAt = timestamp(object.last_settled_at)
    lastBlockedAt = timestamp(object.last_blocked_at)
  }

  if (prevStatus === "working" && SETTLED.has(status)) {
    lastSettledAt = now
  }

  if (status === "blocked" && isAgentStatus(prevStatus) && prevStatus !== "blocked") {
    lastBlockedAt = now
  }

  return {
    status,
    last_settled_at: lastSettledAt,
    last_blocked_at: lastBlockedAt,
  }
}

export function applyLaunchToState(state: PluginState, paneId: string, now: number): boolean {
  const next = launch(state.agent_settled[paneId], now)

  if (sameSettled(state.agent_settled[paneId], next)) return false

  state.agent_settled[paneId] = settledJson(next)

  return true
}

export function applyToState(
  state: PluginState,
  paneId: string,
  status: AgentStatus,
  now: number,
): boolean {
  const next = transition(state.agent_settled[paneId], status, now)

  if (sameSettled(state.agent_settled[paneId], next)) return false

  state.agent_settled[paneId] = settledJson(next)

  return true
}

export function forgetPane(state: PluginState, paneId: string): boolean {
  if (!(paneId in state.agent_settled)) return false

  delete state.agent_settled[paneId]

  return true
}
