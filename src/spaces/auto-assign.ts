import { join } from "node:path"

import { Effect } from "effect"

import { resolveContextWorkspace } from "../runtime/invocation.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { listWorkspaces } from "../runtime/rpc.ts"
import { load, save } from "../state/store.ts"
import { ensureAll } from "./identity.ts"
import { reconcileMetadata, workspaceFromRpc } from "./metadata.ts"

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

export const runAutoAssign = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const force = argv.includes("--force")

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    assignLocked(paths, output, force),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "auto-assign: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return commandResult(code, output)
})

const assignLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  force: boolean,
) {
  const st = load(statePath(paths.stateDir))
  const workspaces = (yield* listWorkspaces()).map(workspaceFromRpc)

  if (force) {
    const wid = yield* resolveContextWorkspace(paths)

    if (wid !== undefined) delete st.identities[wid]
  }

  const added = ensureAll(st, workspaces)

  yield* reconcileMetadata(paths, output, st, workspaces)
  save(statePath(paths.stateDir), st)

  const listed = added.length > 0 ? added.join(", ") : "(all spaces already had identities)"

  output.stdout.push(`assigned: ${listed}`)

  return 0
})
