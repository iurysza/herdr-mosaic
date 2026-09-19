import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { NotATty } from "../../src/runtime/errors.ts"
import { withRawTerminal } from "../../src/runtime/terminal.ts"

describe("terminal adapter", () => {
  test("non-TTY input is an explicit failure, not a hang", async () => {
    const error = await Effect.runPromise(withRawTerminal(Effect.succeed(1)).pipe(Effect.flip))
    expect(error).toBeInstanceOf(NotATty)
  })

  test("a PTY session enters raw mode, reads input, resizes, cancels, and restores", async () => {
    const driver = join(import.meta.dir, "..", "support", "pty-session.py")
    const session = join(import.meta.dir, "raw-session.ts")

    const proc = Bun.spawn(["python3", driver, process.execPath, session], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    expect(code, stderr).toBe(0)
    expect(stdout).toContain("raw:1")
    expect(stdout).toContain("key:120")
    expect(stdout).toContain("resize:")
    expect(stdout).toContain("restored:1")
  }, 10_000)
})
