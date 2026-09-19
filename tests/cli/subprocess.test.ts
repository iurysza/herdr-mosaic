import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { makeSandbox } from "../support/sandbox.ts"

const repo = join(import.meta.dir, "..", "..")

const cli = join(repo, "src", "cli.ts")

describe("production CLI subprocess", () => {
  test("runs help from an unrelated directory", async () => {
    const sandbox = makeSandbox()

    const proc = Bun.spawn([process.execPath, "--no-env-file", cli, "--help"], {
      cwd: sandbox.root,
      env: sandbox.env,
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    expect(code).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("Space color:")
  })

  test("unknown command from a subprocess exits 2", async () => {
    const sandbox = makeSandbox()

    const proc = Bun.spawn([process.execPath, "--no-env-file", cli, "nosuch"], {
      cwd: sandbox.root,
      env: sandbox.env,
      stdout: "pipe",
      stderr: "pipe",
    })

    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    expect(code).toBe(2)
    expect(stderr).toBe("unknown command 'nosuch'\n")
  })

  test("refresh-worker without a generation key exits 1", async () => {
    const sandbox = makeSandbox()

    const proc = Bun.spawn([process.execPath, "--no-env-file", cli, "refresh-worker"], {
      cwd: sandbox.root,
      env: sandbox.env,
      stdout: "pipe",
      stderr: "pipe",
    })

    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    expect(code).toBe(1)
    expect(stderr).toContain("refresh-worker requires the socket generation from startup")
  })

  test("ignores ambient .env from the working directory", async () => {
    const work = mkdtempSync(join(tmpdir(), "mosaic-ambient-"))
    writeFileSync(join(work, ".env"), "HERDR_PLUGIN_ID=evil.plugin\n")

    const proc = Bun.spawn(
      [process.execPath, "--no-env-file", cli, "--help"],
      {
        cwd: work,
        env: {
          PATH: `${process.execPath.replace(/\/bun$/, "")}:/usr/bin:/bin`,
          HOME: process.env.HOME,
          TERM: "dumb",
          LANG: "C.UTF-8",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    expect(code, stderr).toBe(0)
    expect(stdout).toContain("Space color:")
    expect(stderr).not.toContain("evil.plugin")
  })
})
