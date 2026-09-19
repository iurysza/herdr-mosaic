import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { Effect } from "effect"

import { SCHEMA_VERSION } from "../state/store.ts"
import { MigrationError } from "../runtime/errors.ts"
import { pluginLockPath, withExclusiveLock, atomicWrite } from "../runtime/lock.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { type JsonObject, toJsonObject } from "./json.ts"
import { isFile } from "./files.ts"
import { readJsonObject } from "./read-json.ts"

const CONFIG_NAMES = ["settings.json", "identities.json", "legacy-layouts-settings.json"] as const

export type WindowManagerReport = JsonObject

type PendingCopy = {
  readonly dest: string
  readonly content: string
}

export const importWindowManager = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  dryRun: boolean,
) {
  const oldDir = paths.windowManagerStateDir
  const oldPath = join(oldDir, "state.json")
  const target = join(paths.stateDir, "state.json")

  if (existsSync(target)) {
    return toJsonObject({
      notes: ["kept existing Mosaic state; Window Manager not imported"],
      dry_run: dryRun,
    })
  }

  return yield* withExclusiveLock(
    pluginLockPath(oldDir),
    copyWindowManager(paths, oldDir, oldPath, target, dryRun),
  )
})

const copyWindowManager = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  oldDir: string,
  oldPath: string,
  target: string,
  dryRun: boolean,
) {
  try {
    return copyWindowManagerSync(paths, oldDir, oldPath, target, dryRun)
  } catch (cause) {
    if (cause instanceof MigrationError) return yield* cause

    const detail = cause instanceof Error ? cause.message : String(cause)

    return yield* new MigrationError({ message: detail })
  }
})

function copyWindowManagerSync(
  paths: PluginPathValues,
  oldDir: string,
  oldPath: string,
  target: string,
  dryRun: boolean,
): WindowManagerReport {
  const old = readJsonObject(oldPath)
  const version = old === undefined ? undefined : old.version === undefined ? 1 : old.version

  if (old === undefined || version !== SCHEMA_VERSION) {
    throw new MigrationError({
      message: `unsupported Window Manager state at ${oldPath}`,
    })
  }

  const oldConfig = paths.windowManagerConfigDir
  const copies: Array<readonly [string, string]> = []

  for (const name of CONFIG_NAMES) {
    const source = join(oldConfig, name)

    if (existsSync(source)) {
      readJsonObject(source)
      copies.push([source, join(paths.configDir, name)])
    }
  }

  const names = readdirSync(oldDir).sort()

  for (const name of names) {
    if (name.startsWith("config.backup.") && name.endsWith(".toml")) {
      copies.push([join(oldDir, name), join(paths.stateDir, name)])
    }
  }

  const pending: PendingCopy[] = []

  for (const [source, dest] of copies) {
    const content = readFileSync(source, "utf8")

    if (existsSync(dest)) {
      if (readFileSync(dest, "utf8") !== content) {
        throw new MigrationError({
          message: `Window Manager import conflicts with ${dest}; `
            + "existing Mosaic files are never overwritten",
        })
      }
    } else {
      pending.push({ dest, content })
    }
  }

  const originalState = readFileSync(oldPath, "utf8")

  if (!dryRun) {
    for (const file of pending) {
      atomicWrite(file.dest, file.content)
    }

    atomicWrite(
      join(paths.stateDir, "window-manager-import.json"),
      `{"source": ${JSON.stringify(oldPath)}}\n`,
    )
    atomicWrite(target, originalState)
  }

  const filesCopied: string[] = pending.map((file) => file.dest)

  filesCopied.push(target)

  return toJsonObject({
    window_manager_state_dir: oldDir,
    window_manager_config_dir: oldConfig,
    files_copied: filesCopied,
    dry_run: dryRun,
    notes: [
      "preserved Window Manager state, including restore backups",
      "left original files in place; Chromatic state not imported",
    ],
  })
}

export function windowManagerStatePresent(paths: PluginPathValues): boolean {
  return isFile(join(paths.windowManagerStateDir, "state.json"))
}
