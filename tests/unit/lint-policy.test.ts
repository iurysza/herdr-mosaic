import { unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

const repo = join(import.meta.dir, "..", "..")

const oxlint = join(repo, "node_modules", ".bin", "oxlint")

async function lintSnippet(filename: string, source: string) {
  const probe = join(repo, "src", filename)
  writeFileSync(probe, source)

  try {
    const proc = Bun.spawn([oxlint, probe], {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited

    return { code, output: `${stdout}\n${stderr}` }
  } finally {
    unlinkSync(probe)
  }
}

describe("no-module-mocking", () => {
  test("rejects Bun mock.module", async () => {
    const result = await lintSnippet(
      ".lint-probe-bun.ts",
      'import { mock } from "bun:test"\n\nmock.module("./user-store", () => ({}))\n',
    )

    expect(result.code).not.toBe(0)
    expect(result.output).toContain("anti-slop(no-module-mocking)")
  })

  test("rejects Vitest vi.mock", async () => {
    const result = await lintSnippet(
      ".lint-probe-vitest.ts",
      'import { vi } from "vitest"\n\nvi.mock("./user-store")\n',
    )

    expect(result.code).not.toBe(0)
    expect(result.output).toContain("anti-slop(no-module-mocking)")
  })
})
