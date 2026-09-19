import { Effect, Predicate, Result, Schema } from "effect"

import { PLUGIN_ID } from "../ids.ts"
import { pluginLog, pluginWarn, type CapturedOutput } from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import {
  listAgents,
  listWorkspaces,
  rpcTryCall,
  type JsonObject,
} from "../runtime/rpc.ts"
import { loadSettings } from "../runtime/settings.ts"
import { identityOf, type PluginState } from "../state/store.ts"
import {
  DEFAULT_MARKER,
  allSlotTokens,
  ensureAll,
  slotForColour,
  slotToken,
  type WorkspaceSnapshot,
} from "./identity.ts"
import { tryApplyLabelRules } from "./labels.ts"

export const NAME_TOKEN = "space_name"

export const COLOUR_TOKEN = "space_colour"

export const LEGACY_EMOJI_TOKEN = "space_emoji"

type Json = typeof Schema.Json.Type

class MetadataTokens {
  private readonly pairs: Array<readonly [string, Json]> = []

  set(name: string, value: Json): this {
    this.pairs.push([name, value])

    return this
  }

  toParams(): JsonObject {
    const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(Object.fromEntries(this.pairs))

    if (Result.isFailure(decoded)) return {}

    return decoded.success
  }
}

export type AgentSnapshot = {
  readonly pane_id?: string
  readonly workspace_id?: string
}

function optionalString(value: Json | undefined): string | undefined {
  return Predicate.isString(value) && value !== "" ? value : undefined
}

export function workspaceFromRpc(object: JsonObject): WorkspaceSnapshot {
  const number = object.number
  const label = object.label

  return {
    workspace_id: optionalString(object.workspace_id),
    number: Predicate.isNumber(number) ? number : undefined,
    label: Predicate.isString(label) ? label : undefined,
    focused: object.focused === true,
  }
}

export function agentFromRpc(object: JsonObject): AgentSnapshot {
  return {
    pane_id: optionalString(object.pane_id),
    workspace_id: optionalString(object.workspace_id),
  }
}

export function markerGlyph(paths: PluginPathValues): string {
  const marker = loadSettings(paths).marker

  if (Predicate.isString(marker) && marker !== "") return marker

  return DEFAULT_MARKER
}

export function workspaceIdOfPane(paneId: string): string | undefined {
  const id = paneId.split(":", 1)[0]

  return id === undefined || id === "" ? undefined : id
}

function dotTokens(colour: string, glyph: string): MetadataTokens {
  const active = slotToken(slotForColour(colour))
  const out = new MetadataTokens()

  for (const tok of allSlotTokens()) {
    out.set(tok, tok === active ? glyph : null)
  }

  return out
}

function clearedTokens(): MetadataTokens {
  const out = new MetadataTokens()

  for (const tok of allSlotTokens()) {
    out.set(tok, null)
  }

  out.set(NAME_TOKEN, null)
  out.set(COLOUR_TOKEN, null)
  out.set(LEGACY_EMOJI_TOKEN, null)

  return out
}

export const publishWorkspace = Effect.fnUntraced(function*(
  workspaceId: string,
  colour: string,
  glyph: string,
) {
  const tokens = dotTokens(colour, glyph)
    .set(COLOUR_TOKEN, colour)
    .set(LEGACY_EMOJI_TOKEN, null)

  return yield* rpcTryCall("workspace.report_metadata", {
    workspace_id: workspaceId,
    source: PLUGIN_ID,
    tokens: tokens.toParams(),
  })
})

export const publishPane = Effect.fnUntraced(function*(
  paneId: string,
  colour: string,
  spaceName: string,
  glyph: string,
) {
  const tokens = dotTokens(colour, glyph)
    .set(NAME_TOKEN, spaceName)
    .set(LEGACY_EMOJI_TOKEN, null)

  return yield* rpcTryCall("pane.report_metadata", {
    pane_id: paneId,
    source: PLUGIN_ID,
    tokens: tokens.toParams(),
  })
})

export const clearWorkspace = Effect.fnUntraced(function*(workspaceId: string) {
  return yield* rpcTryCall("workspace.report_metadata", {
    workspace_id: workspaceId,
    source: PLUGIN_ID,
    tokens: clearedTokens().toParams(),
  })
})

export const clearPane = Effect.fnUntraced(function*(paneId: string) {
  return yield* rpcTryCall("pane.report_metadata", {
    pane_id: paneId,
    source: PLUGIN_ID,
    tokens: clearedTokens().toParams(),
  })
})

export type MetadataReconcileSummary = {
  readonly workspaces: number
  readonly workspaces_failed: number
  readonly panes: number
  readonly panes_failed: number
  readonly identities_assigned: string[]
}

export const reconcileMetadata = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
  workspaces?: readonly WorkspaceSnapshot[],
  agents?: readonly AgentSnapshot[],
  quiet = false,
) {
  const liveWorkspaces = workspaces ?? (yield* listWorkspaces()).map(workspaceFromRpc)
  const liveAgents = agents ?? (yield* listAgents()).map(agentFromRpc)
  const applied = tryApplyLabelRules(state, liveWorkspaces, paths)

  if (applied.error !== undefined) {
    yield* pluginWarn(paths, output, applied.error.message)
  }

  const added = ensureAll(state, liveWorkspaces)
  const glyph = markerGlyph(paths)
  const spaceLabels = new Map<string, string>()
  let wsOk = 0
  let wsFail = 0

  for (const workspace of liveWorkspaces) {
    const wid = workspace.workspace_id

    if (wid === undefined || wid === "") continue

    spaceLabels.set(wid, workspace.label || wid)
    const info = identityOf(state, wid)
    const colour = info === undefined ? undefined : info.colour

    if (!Predicate.isString(colour) || colour === "") continue

    const published = yield* publishWorkspace(wid, colour, glyph)

    if (published.error !== undefined) {
      wsFail += 1
      yield* pluginWarn(paths, output, `workspace metadata failed for ${wid}: ${published.error.message}`)
    } else {
      wsOk += 1
    }
  }

  let paneOk = 0
  let paneFail = 0

  for (const agent of liveAgents) {
    const paneId = agent.pane_id
    const wid = agent.workspace_id ?? (paneId === undefined ? undefined : workspaceIdOfPane(paneId))
    const info = wid === undefined ? undefined : identityOf(state, wid)
    const colour = info === undefined ? undefined : info.colour

    if (paneId === undefined || paneId === "" || !Predicate.isString(colour) || colour === "") continue

    const spaceName = (wid === undefined ? undefined : spaceLabels.get(wid)) ?? wid ?? paneId
    const published = yield* publishPane(paneId, colour, spaceName, glyph)

    if (published.error !== undefined) {
      paneFail += 1
      yield* pluginWarn(paths, output, `pane metadata failed for ${paneId}: ${published.error.message}`)
    } else {
      paneOk += 1
    }
  }

  const summary: MetadataReconcileSummary = {
    workspaces: wsOk,
    workspaces_failed: wsFail,
    panes: paneOk,
    panes_failed: paneFail,
    identities_assigned: added,
  }

  if (!quiet) {
    let msg = `metadata reconciled: ${wsOk} workspaces, ${paneOk} agent panes`

    if (added.length > 0) msg += `; assigned identity to ${added.join(", ")}`

    if (wsFail > 0 || paneFail > 0) {
      msg += ` (${wsFail} workspace / ${paneFail} pane failures)`
    }

    yield* pluginLog(paths, output, msg)
  }

  return summary
})

export const republishPane = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  state: PluginState,
  paneId: string,
  workspaces?: readonly WorkspaceSnapshot[],
) {
  const wid = workspaceIdOfPane(paneId)

  if (wid === undefined) return false

  const info = identityOf(state, wid)
  const colour = info === undefined ? undefined : info.colour

  if (!Predicate.isString(colour) || colour === "") return false

  const live = workspaces ?? (yield* listWorkspaces()).map(workspaceFromRpc)
  let label = wid

  for (const workspace of live) {
    if (workspace.workspace_id === wid) {
      label = workspace.label || wid
      break
    }
  }

  const published = yield* publishPane(paneId, colour, label, markerGlyph(paths))

  if (published.error !== undefined) {
    yield* pluginWarn(paths, output, `pane metadata failed for ${paneId}: ${published.error.message}`)

    return false
  }

  return true
})
