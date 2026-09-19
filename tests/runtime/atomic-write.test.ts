import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { atomicWrite } from "../../src/runtime/lock.ts"
import { defaultState, load, save } from "../../src/state/store.ts"

function waitExit(child: ReturnType<typeof spawn>): Promise<{
  code: number | null
  stdout: string
  stderr: string
}> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

describe("atomic writes", () => {
  test("a leftover tmp file does not change the live JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-atomic-"))
    const path = join(root, "state.json")
    const state = defaultState()

    state.identities = { w1: { colour: "#4f8cff", origin: "manual" } }
    save(path, state)
    writeFileSync(join(root, ".state.json.tmp.99999"), "{partial")

    expect(load(path).identities.w1).toEqual({ colour: "#4f8cff", origin: "manual" })
    expect(readFileSync(path, "utf8").startsWith("{")).toBe(true)
  })

  test("a crash after the tmp write leaves the live file intact", async () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-atomic-crash-"))
    const path = join(root, "state.json")
    const original = `${JSON.stringify({ ok: true }, null, 2)}\n`

    writeFileSync(path, original)

    const child = spawn(process.execPath, [join(import.meta.dir, "write-tmp-and-hang.ts"), path, "{partial"], {
      stdio: ["ignore", "pipe", "pipe"],
    })

    const line = await new Promise<string>((resolve) => {
      child.stdout?.on("data", (chunk) => resolve(String(chunk)))
    })

    try {
      expect(line.startsWith("tmp:")).toBe(true)
      expect(existsSync(line.slice(4).trim())).toBe(true)
      expect(readFileSync(path, "utf8")).toBe(original)
    } finally {
      child.kill("SIGKILL")
      await waitExit(child)
    }
  }, 10_000)

  test("concurrent writers never expose a partial JSON document", async () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-atomic-race-"))
    const path = join(root, "state.json")

    writeFileSync(path, `${JSON.stringify({ n: 0 })}\n`)

    const writers = [1, 2, 3, 4].map((n) =>
      spawn(process.execPath, [join(import.meta.dir, "atomic-writer.ts"), path, `${JSON.stringify({ n })}\n`], {
        stdio: ["ignore", "pipe", "pipe"],
      })
    )

    const results = await Promise.all(writers.map(waitExit))

    for (const result of results) {
      expect(result.code).toBe(0)
    }

    const text = readFileSync(path, "utf8")

    expect(text.startsWith("{")).toBe(true)
    expect(text.trim().endsWith("}")).toBe(true)
    expect(JSON.parse(text)).toEqual(
      expect.objectContaining({ n: expect.any(Number) }),
    )
    atomicWrite(path, `${JSON.stringify({ n: 9 })}\n`)
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ n: 9 })
  }, 10_000)
})
