import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { NotATty } from "../../src/runtime/errors.ts"
import { withRawTerminal } from "../../src/runtime/terminal.ts"

describe("terminal adapter", () => {
  test("non-TTY input is an explicit failure, not a hang", async () => {
    const error = await Effect.runPromise(withRawTerminal(Effect.succeed(1)).pipe(Effect.flip))
    expect(error).toBeInstanceOf(NotATty)
  })

})
