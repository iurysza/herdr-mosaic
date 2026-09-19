import { Effect } from "effect"

import { runCommand } from "./dispatch/main.ts"
import { PLUGIN_ID } from "./ids.ts"
import { PluginPaths } from "./runtime/paths.ts"

export type CliResult = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function pythonRepr(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
}

export const runCli = Effect.fnUntraced(function*(argv: readonly string[]) {
  return yield* runCommand(argv).pipe(
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
