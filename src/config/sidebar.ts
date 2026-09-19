import { join } from "node:path"

import { Clock, Effect, Predicate, Result, Schema } from "effect"

import { ConfigError } from "../runtime/errors.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginLog,
  pluginWarn,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { load, save, type PluginState } from "../state/store.ts"
import { reloadConfig } from "./reload.ts"
import {
  TomlTable,
  type TomlValue,
} from "./toml-edit.ts"
import {
  commitDoc,
  currentOwnedSidebar,
  detectConflicts,
  installSidebar,
  loadDoc,
  restoreBackup,
  snapshotConfig,
  type SidebarBackup,
} from "./patch.ts"

type Json = typeof Schema.Json.Type

type JsonObject = typeof Schema.JsonObject.Type

function statePath(stateDir: string): string {
  return join(stateDir, "state.json")
}

function jsonClone(value: SidebarBackup): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(value))
  const decoded = Schema.decodeUnknownResult(Schema.Json)(parsed)

  if (Result.isFailure(decoded)) return null

  return decoded.success
}

function asJson(value: TomlValue): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(value))
  const decoded = Schema.decodeUnknownResult(Schema.Json)(parsed)

  if (Result.isFailure(decoded)) return null

  return decoded.success
}

function asJsonObject(value: Json): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isSuccess(decoded)) return decoded.success

  return {}
}

export function jsonToToml(value: Json): TomlValue {
  if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) {
    return value
  }

  if (Array.isArray(value)) return value.map(jsonToToml)

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return String(value)

  const table = new TomlTable()

  for (const key of Object.keys(decoded.success)) {
    const nested = decoded.success[key]

    if (nested === undefined) continue

    table.set(key, jsonToToml(nested))
  }

  return table
}

export function backupFromJson(value: Json): SidebarBackup | undefined {
  if (value === null) return undefined

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return undefined

  const captured = decoded.success.captured_unix
  const keysJson = decoded.success.keys
  const keysObject = Schema.decodeUnknownResult(Schema.JsonObject)(keysJson ?? {})
  const keys: { [key: string]: SidebarBackup["keys"][string] } = {}

  if (Result.isSuccess(keysObject)) {
    for (const key of Object.keys(keysObject.success)) {
      const info = Schema.decodeUnknownResult(Schema.JsonObject)(keysObject.success[key] ?? null)

      if (Result.isFailure(info)) continue

      if (info.success.present === true) {
        keys[key] = { present: true, value: jsonToToml(info.success.value ?? null) }
      } else {
        keys[key] = { present: false }
      }
    }
  }

  return {
    captured_unix: Predicate.isNumber(captured) ? captured : 0,
    keys,
  }
}

export function lastWrittenPairs(lastWritten: Json): ReadonlyArray<readonly [string, TomlValue]> {
  const object = asJsonObject(lastWritten)
  const pairs: Array<readonly [string, TomlValue]> = []

  for (const key of Object.keys(object)) {
    const nested = object[key]

    if (nested === undefined) continue

    pairs.push([key, jsonToToml(nested)])
  }

  return pairs
}

function mergeLastWritten(state: PluginState, owned: ReturnType<typeof currentOwnedSidebar>): void {
  const next: { [key: string]: Json } = {}
  const current = asJsonObject(state.last_written)

  for (const key of Object.keys(current)) {
    const nested = current[key]

    if (nested !== undefined) next[key] = nested
  }

  for (const item of owned) {
    next[item.key] = asJson(item.value)
  }

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(next)

  state.last_written = Result.isSuccess(decoded) ? decoded.success : {}
}

function dropLastWritten(state: PluginState, keys: ReadonlySet<string>, skip: ReadonlySet<string>): void {
  const next: { [key: string]: Json } = {}
  const current = asJsonObject(state.last_written)

  for (const key of Object.keys(current)) {
    const nested = current[key]

    if (nested === undefined) continue

    if (keys.has(key) && !skip.has(key)) continue

    next[key] = nested
  }

  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(next)

  state.last_written = Result.isSuccess(decoded) ? decoded.success : {}
}

export const runSidebarInstall = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const unix = Math.floor((yield* Clock.currentTimeMillis) / 1000)

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    installLocked(paths, output, unix, argv),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "sidebar-install: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return {
    code,
    stdout: joinOutput(output.stdout),
    stderr: joinOutput(output.stderr),
  } as const
})

const installLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: ReturnType<typeof emptyOutput>,
  unix: number,
  _argv: readonly string[],
) {
  const st = load(statePath(paths.stateDir))
  const doc = loadDoc(paths.herdrConfigPath)

  yield* snapshotConfig(paths.herdrConfigPath, paths.stateDir)

  const installed = (() => {
    try {
      return { ok: true as const, value: installSidebar(doc, unix) }
    } catch (error) {
      return { ok: false as const, error }
    }
  })()

  if (!installed.ok) {
    if (installed.error instanceof ConfigError) {
      yield* pluginWarn(paths, output, installed.error.message)

      return 1
    }

    throw installed.error
  }

  const result = installed.value

  for (const warning of result.warnings) {
    yield* pluginWarn(paths, output, warning)
  }

  if (st.sidebar_backup === null) {
    st.sidebar_backup = jsonClone(result.backup)
  }

  if (st.ownership_baseline === null) {
    st.ownership_baseline = jsonClone(result.backup)
  }

  if (result.changes.length === 0) {
    st.sidebar_installed = true
    mergeLastWritten(st, currentOwnedSidebar(doc))
    save(statePath(paths.stateDir), st)
    output.stdout.push("sidebar already carries the plugin templates; nothing to do")

    return 0
  }

  const committed = yield* commitDoc(doc, paths.herdrConfigPath).pipe(
    Effect.result,
  )

  if (Result.isFailure(committed)) {
    yield* pluginWarn(paths, output, committed.failure.message)

    return 1
  }

  st.sidebar_installed = true
  mergeLastWritten(st, currentOwnedSidebar(doc))
  yield* reloadConfig(paths, output)
  save(statePath(paths.stateDir), st)

  for (const change of result.changes) {
    yield* pluginLog(
      paths,
      output,
      `sidebar ${change.key} (${change.origin}): ${JSON.stringify(change.rows)}`,
    )
  }

  output.stdout.push(`installed tokens into ${result.changes.length} row set(s)`)

  return 0
})

export const runSidebarRemove = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const force = argv.includes("--force")

  const code = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    removeLocked(paths, output, force),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "sidebar-remove: timed out waiting for plugin lock").pipe(
        Effect.as(1),
      )
    ),
  )

  return {
    code,
    stdout: joinOutput(output.stdout),
    stderr: joinOutput(output.stderr),
  } as const
})

const removeLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: ReturnType<typeof emptyOutput>,
  force: boolean,
) {
  const st = load(statePath(paths.stateDir))
  const backup = backupFromJson(st.sidebar_backup)

  if (backup === undefined) {
    output.stdout.push("no sidebar backup recorded; nothing to remove")

    return 0
  }

  const doc = loadDoc(paths.herdrConfigPath)
  const managed = new Set(Object.keys(backup.keys))
  const conflicts = detectConflicts(doc, lastWrittenPairs(st.last_written), managed)
  const skip = new Set<string>()

  if (conflicts.length > 0 && !force) {
    for (const conflict of conflicts) {
      yield* pluginWarn(
        paths,
        output,
        `${conflict.key} changed outside the plugin; leaving it alone `
          + `(--force to restore). plugin wrote ${JSON.stringify(conflict.expected)}, found ${JSON.stringify(conflict.actual)}`,
      )
      skip.add(conflict.key)
    }
  }

  const restored = restoreBackup(doc, backup, [["ui", "sidebar", "spaces"], ["ui", "sidebar", "agents"]], skip)
  const committed = yield* commitDoc(doc, paths.herdrConfigPath).pipe(Effect.result)

  if (Result.isFailure(committed)) {
    yield* pluginWarn(paths, output, committed.failure.message)

    return 1
  }

  dropLastWritten(st, managed, skip)
  st.sidebar_backup = null
  st.sidebar_installed = false
  yield* reloadConfig(paths, output)
  save(statePath(paths.stateDir), st)
  yield* pluginLog(paths, output, `sidebar tokens removed (${restored.length} entries)`)
  output.stdout.push(`restored ${restored.length} row set(s)`)

  return 0
})
