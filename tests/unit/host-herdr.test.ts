import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { isUsableHerdrBin, resolveHostHerdrBin } from "../support/host-herdr.ts"

describe("host Herdr resolution", () => {
  test("skips the isolated missing-herdr placeholder", () => {
    expect(isUsableHerdrBin("/tmp/mosaic-test-x/bin/missing-herdr")).toBe(false)
  })

  test("prefers MOSAIC_HERDR_BIN over HERDR_BIN_PATH", () => {
    const root = process.env.TMPDIR ?? "/tmp"
    const binDir = join(root, "host-herdr-pref")

    mkdirSync(binDir, { recursive: true })

    const preferred = join(binDir, "preferred-herdr")

    writeFileSync(preferred, "")

    const resolved = resolveHostHerdrBin({
      MOSAIC_HERDR_BIN: preferred,
      HERDR_BIN_PATH: join(root, "bin", "missing-herdr"),
      HOME: root,
    })

    expect(resolved).toBe(preferred)
  })
})
