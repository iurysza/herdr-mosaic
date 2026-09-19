#!/usr/bin/env bun
import { Effect } from "effect"

import { pluginLockPath, withExclusiveLock } from "../../src/runtime/lock.ts"

const lockPath = pluginLockPath(process.env.HERDR_PLUGIN_STATE_DIR ?? "/tmp", "plugin.lock")

const holdMs = Number(process.argv[2] ?? "200")

const timeoutMs = Number(process.argv[3] ?? "2000")

const result = await Effect.runPromise(
  withExclusiveLock(
    lockPath,
    Effect.gen(function*() {
      process.stdout.write(`held:${process.pid}\n`)
      yield* Effect.sleep(`${holdMs} millis`)

      return 0
    }),
    timeoutMs,
  ),
)

process.exit(result)
