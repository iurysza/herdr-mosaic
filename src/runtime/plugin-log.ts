import { appendFileSync } from "node:fs"
import { join } from "node:path"

import { Clock, Effect } from "effect"

import type { PluginPathValues } from "./paths.ts"

export function formatPluginStamp(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, "0")

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export type CapturedOutput = {
  stdout: string[]
  stderr: string[]
}

export type CommandResult = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export function emptyOutput(): CapturedOutput {
  return { stdout: [], stderr: [] }
}

export function joinOutput(lines: readonly string[]): string {
  if (lines.length === 0) return ""

  return `${lines.join("\n")}\n`
}

export function appendCommand(acc: CommandResult, next: CommandResult): CommandResult {
  return {
    code: next.code,
    stdout: acc.stdout + next.stdout,
    stderr: acc.stderr + next.stderr,
  }
}

export const pluginLog = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  message: string,
) {
  const ms = yield* Clock.currentTimeMillis
  const line = `${formatPluginStamp(ms)} ${message}`

  output.stdout.push(line)
  appendPluginLog(paths.stateDir, line)
})

export const pluginWarn = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
  message: string,
) {
  const ms = yield* Clock.currentTimeMillis
  const line = `${formatPluginStamp(ms)} WARN ${message}`

  output.stderr.push(line)
  appendPluginLog(paths.stateDir, line)
})

function appendPluginLog(stateDir: string, line: string): void {
  try {
    appendFileSync(join(stateDir, "plugin.log"), `${line}\n`, "utf8")
  } catch {
    // logging must not fail the command
  }
}
