import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

describe("real subprocess time", () => {
  test("a child sleep is measured on the wall clock", async () => {
    const started = Date.now()

    const proc = Bun.spawn(["python3", "-c", "import time; time.sleep(0.2)"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: mkdtempSync(join(tmpdir(), "mosaic-clock-")),
    })

    expect(await proc.exited).toBe(0)
    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
  }, 10_000)
})
