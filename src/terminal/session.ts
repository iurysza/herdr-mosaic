import { Effect } from "effect"

import { withRawTerminal } from "../runtime/terminal.ts"
import { decodeKeys, type Key } from "./keys.ts"
import { ansi, size, type Screen } from "./screen.ts"

export type LoopStop = {
  readonly type: "stop"
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type LoopEvent<S> = { readonly type: "continue"; readonly state: S } | LoopStop

export type LoopResult = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const readKey = Effect.fnUntraced(function*(
  queue: Key[],
  pending: { codes: number[] },
) {
  if (queue.length > 0) {
    const key = queue.shift()

    if (key !== undefined) return key
  }

  return yield* Effect.callback<Key>((resume, signal) => {
    let settled = false

    const onData = (chunk: Buffer) => {
      if (settled) return

      const decoded = decodeKeys(chunk, pending.codes)

      pending.codes = decoded.pending

      for (const key of decoded.keys) queue.push(key)

      const first = queue.shift()

      if (first === undefined) return

      settled = true
      process.stdin.off("data", onData)
      resume(Effect.succeed(first))
    }

    const onAbort = () => {
      if (settled) return

      settled = true
      process.stdin.off("data", onData)
      resume(Effect.succeed({ type: "escape" }))
    }

    signal.addEventListener("abort", onAbort, { once: true })
    process.stdin.on("data", onData)

    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort)
      process.stdin.off("data", onData)
    })
  })
})

export const runRawLoop = Effect.fnUntraced(function*<S, E, R>(
  initial: S,
  render: (state: S, rows: number, cols: number) => Screen,
  handle: (state: S, key: Key) => Effect.Effect<LoopEvent<S>, E, R>,
) {
  return yield* withRawTerminal(
    Effect.suspend(() => {
      const queue: Key[] = []
      const pendingCodes: number[] = []
      const pending = { codes: pendingCodes }
      let state = initial

      const paint = () => {
        const { rows, cols } = size()

        process.stdout.write(ansi(render(state, rows, cols)))
      }

      return Effect.gen(function*() {
        process.stdin.resume()
        process.on("SIGWINCH", paint)
        paint()

        while (true) {
          const key = yield* readKey(queue, pending)
          const event = yield* handle(state, key)

          if (event.type === "stop") {
            process.stdout.write("\u001b[0m\u001b[?25h")

            return {
              code: event.code,
              stdout: event.stdout,
              stderr: event.stderr,
            } satisfies LoopResult
          }

          state = event.state
          paint()
        }
      }).pipe(
        Effect.ensuring(Effect.sync(() => {
          process.off("SIGWINCH", paint)
          process.stdout.write("\u001b[0m\u001b[?25h")
        })),
      )
    }),
  )
})
