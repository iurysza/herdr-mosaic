import { Effect, Result } from "effect"

import { publishOnce } from "./agents/sidebar-publish.ts"
import { rewriteArgv, wantsHelp } from "./dispatch/catalog.ts"
import { runCommand } from "./dispatch/main.ts"
import { PLUGIN_ID } from "./ids.ts"
import { LockTimeout, RpcTransportError } from "./runtime/errors.ts"
import { PluginPaths } from "./runtime/paths.ts"
import { emptyOutput, joinOutput, pluginWarn } from "./runtime/plugin-log.ts"

export type CliResult = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const REFRESH_COMMANDS = new Set(["install", "reconcile", "apply-identity", "repalette"])

const REFRESH_EVENTS = new Set([
  "tab.renamed",
  "pane.agent_detected",
  "pane.moved",
  "pane.agent_status_changed",
])

function pythonRepr(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

function refreshNeeded(argv: readonly string[]): boolean {
  const rewritten = rewriteArgv(argv)
  const command = rewritten[0]

  if (command === undefined || rewritten.includes("--dry-run")) return false

  if (REFRESH_COMMANDS.has(command)) return true

  return command === "event" && rewritten[1] !== undefined && REFRESH_EVENTS.has(rewritten[1])
}

export const runCli = Effect.fnUntraced(function*(argv: readonly string[]) {
  const result = yield* runCommand(argv).pipe(
    Effect.catchTags({
      UnknownCommand: (err) =>
        Effect.succeed({
          code: 2,
          stdout: "",
          stderr: `unknown command ${pythonRepr(err.command)}\n`,
        } satisfies CliResult),
      WrongPluginId: (err) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: `Mosaic cannot run as ${err.registeredId}; restore and remove that registration `
            + `before registering this checkout as ${PLUGIN_ID}\n`,
        } satisfies CliResult),
      WindowManagerPending: (err) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: `Compatible saved data awaits import; review it before setup `
            + `and run Mosaic's migrate action before ${err.command}\n`,
        } satisfies CliResult),
      UnimplementedCommand: (err) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: `mosaic: ${err.command} is not implemented in this TypeScript candidate\n`,
        } satisfies CliResult),
      CommandFailed: (err) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: `${err.command}: ${err.message}\n`,
        } satisfies CliResult),
      FlockError: (err) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: `${err.message}\n`,
        } satisfies CliResult),
      RpcTransportError: (err) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: `herdr API error: ${err.code}: ${err.message}\n`,
        } satisfies CliResult),
    }),
  )

  if (result.code !== 0 || wantsHelp(argv) || !refreshNeeded(argv)) return result

  const paths = yield* PluginPaths
  const output = emptyOutput()
  const command = rewriteArgv(argv)[0] ?? ""
  const published = yield* publishOnce(paths).pipe(Effect.result)

  if (Result.isSuccess(published)) return result

  const error = published.failure

  if (error instanceof RpcTransportError) {
    yield* pluginWarn(paths, output, `herdr API error in ${command}: ${error.code}: ${error.message}`)
  } else if (error instanceof LockTimeout) {
    yield* pluginWarn(paths, output, "sidebar publish: timed out waiting for plugin lock")
  } else {
    yield* pluginWarn(paths, output, `${command}: ${String(error)}`)
  }

  return {
    code: 1,
    stdout: result.stdout,
    stderr: result.stderr + joinOutput(output.stderr),
  } satisfies CliResult
})

export const mainLayer = PluginPaths.layer

export function writeResult(result: CliResult): void {
  if (result.stdout !== "") process.stdout.write(result.stdout)

  if (result.stderr !== "") process.stderr.write(result.stderr)
}

if (import.meta.main) {
  const argv = process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")
    ? process.argv.slice(2)
    : process.argv.slice(1)

  const result = await Effect.runPromise(
    runCli(argv).pipe(Effect.provide(mainLayer)),
  )

  writeResult(result)
  process.exit(result.code)
}
