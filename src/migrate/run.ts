import { Effect, Predicate } from "effect"

import { MigrationError } from "../runtime/errors.ts"
import { pluginLockPath, withExclusiveLock } from "../runtime/lock.ts"
import {
  emptyOutput,
  joinOutput,
  pluginWarn,
  type CapturedOutput,
} from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { load, save } from "../state/store.ts"
import { chromaticReportJson, importLegacy } from "./chromatic.ts"
import { dumpReport, toJsonObject, type JsonObject } from "./json.ts"
import { alreadyImported, mosaicStatePath, snapshotOwnershipBaseline } from "./ownership.ts"
import { importWindowManager, windowManagerStatePresent } from "./window-manager.ts"

type MigrateSuccess = {
  readonly code: 0
  readonly report: JsonObject
}

type MigrateFailure = {
  readonly code: 1
  readonly report: undefined
}

function commandResult(code: number, stdout: string, stderr: string) {
  return { code, stdout, stderr } as const
}

export const runMigrate = Effect.fnUntraced(function*(argv: readonly string[]) {
  const paths = yield* PluginPaths
  const output = emptyOutput()
  const force = argv.includes("--force")
  const dryRun = argv.includes("--dry-run")

  const outcome = yield* withExclusiveLock(
    pluginLockPath(paths.stateDir),
    migrateLocked(paths, force, dryRun),
  ).pipe(
    Effect.catchTag("LockTimeout", () =>
      pluginWarn(paths, output, "migrate: timed out waiting for plugin lock").pipe(
        Effect.as({ code: 1, report: undefined } satisfies MigrateFailure),
      )
    ),
    Effect.catchTag("MigrationError", (err) => failMigrate(paths, output, err.message)),
  )

  if (outcome.report === undefined) {
    return commandResult(outcome.code, "", joinOutput(output.stderr))
  }

  return commandResult(0, formatReport(outcome.report), joinOutput(output.stderr))
})

const failMigrate = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  message: string,
) {
  yield* pluginWarn(paths, output, message)
  output.stderr.push(message)

  return { code: 1, report: undefined } satisfies MigrateFailure
})

const migrateLocked = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  force: boolean,
  dryRun: boolean,
) {
  const report = yield* collectReport(paths, force, dryRun)

  return { code: 0, report } satisfies MigrateSuccess
})

const collectReport = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  force: boolean,
  dryRun: boolean,
) {
  if (alreadyImported(paths)) {
    return toJsonObject({
      notes: ["kept existing Mosaic state; Window Manager was already imported"],
      dry_run: dryRun,
    })
  }

  if (windowManagerStatePresent(paths)) {
    return toJsonObject(yield* importWindowManager(paths, dryRun))
  }

  const state = load(mosaicStatePath(paths.stateDir))

  try {
    const chromatic = importLegacy(paths, state, force, dryRun)

    if (!dryRun) {
      yield* snapshotOwnershipBaseline(paths, state)
      chromatic.notes.push("snapshotted current config as ownership baseline")
      save(mosaicStatePath(paths.stateDir), state)
    }

    return chromaticReportJson(chromatic)
  } catch (cause) {
    if (cause instanceof MigrationError) return yield* cause

    const detail = cause instanceof Error ? cause.message : String(cause)

    return yield* new MigrationError({ message: detail })
  }
})

function formatReport(report: JsonObject): string {
  const text = dumpReport(report)
  const ignored = report.ignored_stale_backups

  if (!Array.isArray(ignored) || ignored.length === 0) return text

  const names: string[] = []

  for (const item of ignored) {
    if (Predicate.isString(item)) names.push(item)
  }

  if (names.length === 0) return text

  return `${text}ignored stale Chromatic backups: ${names.join(", ")}\n`
}
