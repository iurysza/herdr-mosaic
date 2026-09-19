import { existsSync } from "node:fs"
import { join } from "node:path"

import { Clock, Effect, Result, Schema } from "effect"

import { captureBackup, loadDoc, ownedSidebarKeys, type SidebarBackup } from "../config/patch.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import type { PluginState } from "../state/store.ts"

type Json = typeof Schema.Json.Type

function backupToJson(value: SidebarBackup): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(value))
  const decoded = Schema.decodeUnknownResult(Schema.Json)(parsed)

  if (Result.isFailure(decoded)) return null

  return decoded.success
}

export const snapshotOwnershipBaseline = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  state: PluginState,
) {
  const unix = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  const captured = captureBackup(loadDoc(paths.herdrConfigPath), ownedSidebarKeys(), unix)
  const json = backupToJson(captured)

  if (state.ownership_baseline === null) state.ownership_baseline = json

  if (state.sidebar_backup === null) state.sidebar_backup = json
})

export function mosaicStatePath(stateDir: string): string {
  return join(stateDir, "state.json")
}

export function alreadyImported(paths: PluginPathValues): boolean {
  return existsSync(join(paths.stateDir, "window-manager-import.json"))
    && existsSync(join(paths.stateDir, "state.json"))
}
