#!/usr/bin/env bun
import { join } from "node:path"

import { Effect } from "effect"

import { PluginPaths } from "../../src/runtime/paths.ts"
import { startRefreshWorker } from "../../src/runtime/worker.ts"

const cliPath = process.argv[2] ?? join(import.meta.dir, "..", "..", "src", "cli.ts")

const pid = await Effect.runPromise(
  startRefreshWorker(process.execPath, cliPath).pipe(
    Effect.provide(PluginPaths.layer),
    Effect.catchTag("CommandFailed", () => Effect.succeed(-1)),
    Effect.catchTag("LockTimeout", () => Effect.succeed(-1)),
    Effect.catchTag("FlockError", () => Effect.succeed(-1)),
    Effect.catchTag("RpcTransportError", () => Effect.succeed(-1)),
  ),
)

process.stdout.write(`pid:${pid}\n`)

process.exit(pid < 0 ? 1 : 0)
