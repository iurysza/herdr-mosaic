import { Effect } from "effect"

import { COMMAND_SET, helpText, rewriteArgv, wantsHelp } from "./catalog.ts"
import { PLUGIN_ID } from "../ids.ts"
import { windowManagerPending } from "../migrate/pending.ts"
import {
  CommandFailed,
  UnimplementedCommand,
  UnknownCommand,
  WindowManagerPending,
  WrongPluginId,
} from "../runtime/errors.ts"
import { PluginPaths } from "../runtime/paths.ts"
import { runRefreshWorker } from "../runtime/worker.ts"

export const runCommand = Effect.fnUntraced(function*(argv: readonly string[]) {
  if (wantsHelp(argv)) {
    return { code: 0, stdout: helpText(), stderr: "" } as const
  }

  const rewritten = rewriteArgv(argv)
  const command = rewritten[0]

  if (command === undefined || !COMMAND_SET.has(command)) {
    return yield* new UnknownCommand({ command: command ?? "" })
  }

  const paths = yield* PluginPaths

  if (paths.registeredPluginId !== undefined && paths.registeredPluginId !== PLUGIN_ID) {
    return yield* new WrongPluginId({ registeredId: paths.registeredPluginId })
  }

  if (command !== "migrate" && command !== "install" && windowManagerPending(paths)) {
    return yield* new WindowManagerPending({ command })
  }

  if (command === "refresh-worker") {
    const key = rewritten[1]

    if (rewritten.length !== 2 || key === undefined || key === "") {
      return yield* new CommandFailed({
        command,
        message: "refresh-worker requires the socket generation from startup",
      })
    }

    const code = yield* runRefreshWorker(key)

    return { code, stdout: "", stderr: "" } as const
  }

  return yield* new UnimplementedCommand({ command })
})
