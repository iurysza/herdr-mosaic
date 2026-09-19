import { Effect } from "effect"

import { COMMAND_SET, helpText, rewriteArgv, wantsHelp } from "./catalog.ts"
import { runApplyIdentity } from "../spaces/apply-identity.ts"
import { runAutoAssign } from "../spaces/auto-assign.ts"
import { runMigrate } from "../migrate/run.ts"
import {
  runIdleKeybindInstall,
  runIdleKeybindRemove,
  runKeybindInstall,
  runKeybindRemove,
  runPaneMoveKeybindInstall,
  runPaneMoveKeybindRemove,
  runPromotePaneKeybindInstall,
  runPromotePaneKeybindRemove,
  runPruneKeybindInstall,
  runPruneKeybindRemove,
  runSortKeybindInstall,
  runSortKeybindRemove,
} from "../config/keybinds.ts"
import { runSidebarInstall, runSidebarRemove } from "../config/sidebar.ts"
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

  if (command === "apply-identity") {
    return yield* runApplyIdentity(rewritten.slice(1))
  }

  if (command === "auto-assign") {
    return yield* runAutoAssign(rewritten.slice(1))
  }

  if (command === "migrate") {
    return yield* runMigrate(rewritten.slice(1))
  }

  if (command === "keybind-install") {
    return yield* runKeybindInstall(rewritten.slice(1))
  }

  if (command === "keybind-remove") {
    return yield* runKeybindRemove(rewritten.slice(1))
  }

  if (command === "sort-keybind-install") {
    return yield* runSortKeybindInstall(rewritten.slice(1))
  }

  if (command === "sort-keybind-remove") {
    return yield* runSortKeybindRemove(rewritten.slice(1))
  }

  if (command === "idle-keybind-install") {
    return yield* runIdleKeybindInstall(rewritten.slice(1))
  }

  if (command === "idle-keybind-remove") {
    return yield* runIdleKeybindRemove(rewritten.slice(1))
  }

  if (command === "prune-keybind-install") {
    return yield* runPruneKeybindInstall(rewritten.slice(1))
  }

  if (command === "prune-keybind-remove") {
    return yield* runPruneKeybindRemove(rewritten.slice(1))
  }

  if (command === "pane-move-keybind-install") {
    return yield* runPaneMoveKeybindInstall(rewritten.slice(1))
  }

  if (command === "pane-move-keybind-remove") {
    return yield* runPaneMoveKeybindRemove(rewritten.slice(1))
  }

  if (command === "promote-pane-keybind-install") {
    return yield* runPromotePaneKeybindInstall(rewritten.slice(1))
  }

  if (command === "promote-pane-keybind-remove") {
    return yield* runPromotePaneKeybindRemove(rewritten.slice(1))
  }

  if (command === "sidebar-install") {
    return yield* runSidebarInstall(rewritten.slice(1))
  }

  if (command === "sidebar-remove") {
    return yield* runSidebarRemove(rewritten.slice(1))
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
