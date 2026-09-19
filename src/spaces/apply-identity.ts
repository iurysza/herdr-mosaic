import { join } from "node:path"

import { Effect, Predicate } from "effect"

import { flagString, parseKv } from "../dispatch/flags.ts"
import { resolveContextWorkspace } from "../runtime/invocation.ts"
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
import { listAgents, listWorkspaces } from "../runtime/rpc.ts"
import { identityOf, load, save, setIdentity } from "../state/store.ts"
import {
  SLOT_NAMES,
  allocate,
  colourName,
  isExactPaletteColour,
  resolveColour,
  slotForColour,
} from "./identity.ts"
import {
  agentFromRpc,
  markerGlyph,
  publishWorkspace,
  republishPane,
  workspaceFromRpc,
} from "./metadata.ts"

function statePath(stateDir: string): string {
  return join(stateDir, "state.json")
}

function pythonRepr(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

function commandResult(code: number, output: CapturedOutput) {
  return {
    code,
    stdout: joinOutput(output.stdout),
    stderr: joinOutput(output.stderr),
  } as const
}

export const runApplyIdentity = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const flags = parseKv(argv)
  const requested = flagString(flags, "workspace") ?? (yield* resolveContextWorkspace(paths))

  if (requested === undefined) {
    yield* pluginWarn(paths, output, "no workspace specified")

    return commandResult(1, output)
  }

  if (flags.has("emoji")) {
    yield* pluginWarn(
      paths,
      output,
      "--emoji is no longer used; identity is a colour and the sidebar "
        + "marker is a dot in that colour (set `marker` in settings.json "
        + "to change the glyph). Ignoring it.",
    )
  }

  const colourIn = flagString(flags, "colour") ?? flagString(flags, "color")

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    applyLocked(paths, output, requested, colourIn),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "apply-identity: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const applyLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  workspaceId: string,
  colourIn: string | undefined,
) {
  const st = load(statePath(paths.stateDir))
  const current = identityOf(st, workspaceId) ?? {}
  let colour = Predicate.isString(current.colour) ? current.colour : undefined

  if (colourIn !== undefined) {
    colour = resolveColour(colourIn)

    if (colour === undefined) {
      yield* pluginWarn(
        paths,
        output,
        `${pythonRepr(colourIn)} is not a palette name (${SLOT_NAMES.join(", ")}) or a #rrggbb hex colour`,
      )

      return 1
    }
  }

  const workspaces = (yield* listWorkspaces()).map(workspaceFromRpc)

  if (colour === undefined) {
    colour = allocate(st, workspaceId, workspaces).colour
  }

  setIdentity(st, workspaceId, colour, "manual")
  yield* publishWorkspace(workspaceId, colour, markerGlyph(paths))

  const agents = (yield* listAgents()).map(agentFromRpc)

  for (const agent of agents) {
    if (agent.workspace_id === workspaceId && agent.pane_id !== undefined) {
      yield* republishPane(paths, output, st, agent.pane_id, workspaces)
    }
  }

  const slot = slotForColour(colour)

  yield* pluginLog(
    paths,
    output,
    `identity for ${workspaceId} set to ${colourName(colour)} (slot ${slot})`,
  )

  save(statePath(paths.stateDir), st)

  let note = ""

  if (!isExactPaletteColour(colour)) {
    note = "  (custom hex: tint uses it exactly; the sidebar dot borrows "
      + `the nearest palette slot, ${slot})`
  }

  output.stdout.push(`${workspaceId} -> ${markerGlyph(paths)} ${colour}${note}`)

  return 0
})
