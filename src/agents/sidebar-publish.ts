import { join } from "node:path"

import { Clock, Effect, Predicate, Result, Schema } from "effect"

import { ELAPSED_SOURCE, ELAPSED_TTL_MS, TITLE_SOURCE } from "../ids.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { listAgents, listTabs, rpcCall, type JsonObject } from "../runtime/rpc.ts"
import { load, type PluginState } from "../state/store.ts"
import { PALETTE, slotForColour } from "../spaces/identity.ts"
import { elapsedLabelFor, elapsedLabels } from "./elapsed.ts"

type Json = typeof Schema.Json.Type

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

function jsonObject(value: Json | undefined): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isSuccess(decoded)) return decoded.success

  return {}
}

function firstText(...values: ReadonlyArray<Json | undefined>): string | undefined {
  for (const value of values) {
    if (Predicate.isString(value) && value !== "") return value
  }

  return undefined
}

function tokensObject(pairs: ReadonlyArray<readonly [string, Json]>): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(Object.fromEntries(pairs))

  if (Result.isFailure(decoded)) return {}

  return decoded.success
}

export function titleTokens(agent: JsonObject, tabs: JsonObject, identities: JsonObject): JsonObject {
  const tabId = Predicate.isString(agent.tab_id) ? agent.tab_id : undefined
  const workspaceId = Predicate.isString(agent.workspace_id) ? agent.workspace_id : undefined
  const paneId = Predicate.isString(agent.pane_id) ? agent.pane_id : ""

  const title = firstText(
    tabId === undefined ? undefined : tabs[tabId],
    agent.terminal_title_stripped,
    agent.name,
    agent.display_agent,
    agent.agent,
    paneId,
  ) ?? paneId

  const colour = firstText(jsonObject(workspaceId === undefined ? undefined : identities[workspaceId]).colour)
  const fallback = PALETTE[0]?.[1] ?? "#eba0ac"
  const slot = slotForColour(colour ?? fallback)
  const pairs: Array<readonly [string, Json]> = []

  for (const [name] of PALETTE) {
    pairs.push([`title_${name}`, name === slot ? title : null])
  }

  return tokensObject(pairs)
}

function tabLabels(tabs: readonly JsonObject[]): JsonObject {
  const pairs: Array<readonly [string, Json]> = []

  for (const tab of tabs) {
    const id = tab.tab_id
    const label = tab.label

    if (!Predicate.isString(id) || id === "" || !Predicate.isString(label)) continue

    pairs.push([id, label])
  }

  return tokensObject(pairs)
}

export const publishSidebar = Effect.fnUntraced(function*(
  state: PluginState,
  agents?: readonly JsonObject[],
) {
  const live = agents ?? (yield* listAgents())
  const tabs = tabLabels(yield* listTabs())
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  const paneIds: string[] = []

  for (const agent of live) {
    const paneId = agent.pane_id

    if (Predicate.isString(paneId) && paneId !== "") paneIds.push(paneId)
  }

  const clocks = elapsedLabels(jsonObject(state.agent_settled), paneIds, now)

  for (const agent of live) {
    const paneId = agent.pane_id

    if (!Predicate.isString(paneId) || paneId === "") continue

    yield* rpcCall("pane.report_metadata", {
      pane_id: paneId,
      source: TITLE_SOURCE,
      tokens: titleTokens(agent, tabs, jsonObject(state.identities)),
    })

    yield* rpcCall("pane.report_metadata", {
      pane_id: paneId,
      source: ELAPSED_SOURCE,
      tokens: tokensObject([["elapsed", elapsedLabelFor(clocks, paneId)]]),
      ttl_ms: ELAPSED_TTL_MS,
    })
  }

  return live.length
})

export const publishOnce = Effect.fnUntraced(function*(paths: PluginPathValues) {
  return yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    publishOnceLocked(paths),
  )
})

const publishOnceLocked = Effect.fnUntraced(function*(paths: PluginPathValues) {
  const state = load(statePath(paths.stateDir))

  if (!state.sidebar_installed) return 0

  return yield* publishSidebar(state)
})

export const runElapsedPublish = Effect.fnUntraced(function*(_argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    elapsedPublishLocked(paths),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "elapsed-publish: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const elapsedPublishLocked = Effect.fnUntraced(function*(paths: PluginPathValues) {
  const agents = yield* listAgents()
  const state = load(statePath(paths.stateDir))
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  const paneIds: string[] = []

  for (const agent of agents) {
    const paneId = agent.pane_id

    if (Predicate.isString(paneId) && paneId !== "") paneIds.push(paneId)
  }

  const clocks = elapsedLabels(jsonObject(state.agent_settled), paneIds, now)

  for (const paneId of paneIds) {
    yield* rpcCall("pane.report_metadata", {
      pane_id: paneId,
      source: ELAPSED_SOURCE,
      tokens: tokensObject([["elapsed", elapsedLabelFor(clocks, paneId)]]),
      ttl_ms: ELAPSED_TTL_MS,
    })
  }

  return 0
})
