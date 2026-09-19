#!/usr/bin/env bun
import { Effect } from "effect"

import { withRawTerminal } from "../../src/runtime/terminal.ts"

const program = withRawTerminal(Effect.callback<number>((resume) => {
  process.stdout.write("raw:1\n")

  const onResize = () => {
    process.stdout.write(`resize:${process.stdout.columns}:${process.stdout.rows}\n`)
  }

  process.on("SIGWINCH", onResize)

  const onData = (chunk: Buffer) => {
    const byte = chunk[0]

    if (byte === undefined) return

    process.stdout.write(`key:${byte}\n`)

    if (byte === 3) {
      process.off("SIGWINCH", onResize)
      process.stdin.off("data", onData)
      resume(Effect.succeed(0))
    }
  }

  process.stdin.on("data", onData)

  return Effect.sync(() => {
    process.off("SIGWINCH", onResize)
    process.stdin.off("data", onData)
  })
}))

const code = await Effect.runPromise(program.pipe(
  Effect.ensuring(Effect.sync(() => {
    process.stdout.write("restored:1\n")
  })),
))

process.exit(code)
