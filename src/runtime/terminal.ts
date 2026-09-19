import { Effect } from "effect"

import { NotATty } from "./errors.ts"

export const withRawTerminal = Effect.fnUntraced(
  function*<A, E, R>(body: Effect.Effect<A, E, R>) {
    yield* Effect.acquireRelease(
      Effect.suspend(() => {
        const stdin = process.stdin

        if (!stdin.isTTY || stdin.setRawMode === undefined) {
          return new NotATty()
        }

        const wasRaw = stdin.isRaw
        stdin.setRawMode(true)

        return Effect.succeed({
          restore: () => {
            if (stdin.setRawMode !== undefined) stdin.setRawMode(wasRaw)
          },
        })
      }),
      (handle) =>
        Effect.sync(() => {
          handle.restore()
        }),
    )

    return yield* body
  },
  (effect) => Effect.scoped(effect),
)
