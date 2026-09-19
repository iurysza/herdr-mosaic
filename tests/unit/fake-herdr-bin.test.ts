import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { makeSandbox } from "../support/sandbox.ts"

const fakeBin = join(import.meta.dir, "..", "support", "fake-herdr-bin.ts")

describe("fake Herdr executable", () => {
  test("records argv and answers --version without touching a live binary", async () => {
    const sandbox = makeSandbox()
    const logPath = join(sandbox.root, "fake-herdr.log")

    const proc = Bun.spawn([process.execPath, fakeBin, "--version"], {
      env: { ...sandbox.env, MOSAIC_FAKE_HERDR_LOG: logPath, HERDR_BIN_PATH: fakeBin },
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    expect(code).toBe(0)
    expect(stdout).toContain("herdr 0.0-fake")
    expect(await Bun.file(logPath).text()).toContain("--version")
  })
})
