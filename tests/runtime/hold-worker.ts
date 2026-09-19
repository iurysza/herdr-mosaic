#!/usr/bin/env bun
import { Effect } from "effect"

import { withWorkerOwnership } from "../../src/runtime/worker.ts"

const stateDir = process.env.HERDR_PLUGIN_STATE_DIR ?? "/tmp"

const key = process.argv[2] ?? "gen"

const holdMs = Number(process.argv[3] ?? "200")

const code = await Effect.runPromise(
  withWorkerOwnership(
    stateDir,
    key,
    Effect.gen(function*() {
      process.stdout.write(`owned:${process.pid}\n`)
      yield* Effect.sleep(`${holdMs} millis`)
    }),
  ).pipe(
    Effect.catchTag("LockTimeout", () => Effect.succeed(undefined)),
    Effect.as(0),
  ),
)

process.exit(code)
