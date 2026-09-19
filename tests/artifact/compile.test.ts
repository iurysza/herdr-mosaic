import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { makeSandbox } from "../support/sandbox.ts"

const repo = join(import.meta.dir, "..", "..")

const cli = join(repo, "src", "cli.ts")

describe("compiled CLI", () => {
  test("runs under minimal PATH without .env or bunfig", async () => {
    const sandbox = makeSandbox()
    const work = mkdtempSync(join(tmpdir(), "mosaic-artifact-"))
    writeFileSync(join(work, ".env"), "HERDR_PLUGIN_ID=evil.plugin\n")
    writeFileSync(join(work, "bunfig.toml"), "preload = [\"./kill.ts\"]\n")
    writeFileSync(join(work, "kill.ts"), "process.exit(99)\n")
    mkdirSync(join(sandbox.root, "bin"), { recursive: true })
    const outfile = join(sandbox.root, "bin", "mosaic")

    const build = Bun.spawn(
      [
        process.execPath,
        "build",
        cli,
        "--compile",
        "--outfile",
        outfile,
        "--no-compile-autoload-dotenv",
        "--no-compile-autoload-bunfig",
      ],
      { cwd: repo, stdout: "pipe", stderr: "pipe" },
    )

    const buildErr = await new Response(build.stderr).text()
    expect(await build.exited, buildErr).toBe(0)

    const proc = Bun.spawn([outfile, "--help"], {
      cwd: work,
      env: {
        ...sandbox.env,
        PATH: "/usr/bin:/bin",
        HERDR_PLUGIN_ID: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    expect(code, stderr).toBe(0)
    expect(stdout).toContain("Space color:")
    expect(stderr).not.toContain("evil.plugin")
  }, 60_000)
})
