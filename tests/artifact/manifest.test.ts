import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { processCliArgv } from "../../src/dispatch/catalog.ts"
import { refreshWorkerArgs } from "../../src/runtime/worker.ts"
import { makeSandbox } from "../support/sandbox.ts"

const repo = join(import.meta.dir, "..", "..")

const manifest = readFileSync(join(repo, "herdr-plugin.toml"), "utf8")

describe("production manifest", () => {
  test("every launch command uses the compiled binary", () => {
    const commands = [...manifest.matchAll(/^command = (.+)$/gm)].map((match) => match[1] ?? "")

    expect(commands.length).toBeGreaterThan(0)

    for (const command of commands) {
      expect(command).toContain("$HERDR_PLUGIN_ROOT/dist/mosaic")
    }

    expect(manifest).toContain('id = "picker"')
    expect(manifest).toContain('id = "board"')
    expect(manifest).toContain('id = "prune"')
    expect(manifest).toContain('id = "pane-move"')
    expect(manifest).toContain('[[startup]]')
    expect(manifest).toContain("reconcile")
  })

  test("compiled worker argv omits the source path", () => {
    expect(refreshWorkerArgs("/plugin/dist/mosaic", "/plugin/src/cli.ts", "gen")).toEqual([
      "refresh-worker",
      "gen",
    ])
    expect(processCliArgv(["/plugin/dist/mosaic", "/$bunfs/root/mosaic", "nosuch"])).toEqual(["nosuch"])
    expect(processCliArgv(["bun", "/plugin/src/cli.ts", "doctor"])).toEqual(["doctor"])
  })

  test("the compiled artifact handles help, unknown commands, and worker argv", async () => {
    const sandbox = makeSandbox()
    const outfile = join(sandbox.root, "mosaic")

    const build = Bun.spawn(
      [
        process.execPath,
        "build",
        join(repo, "src", "cli.ts"),
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

    const help = Bun.spawn([outfile, "--help"], {
      cwd: sandbox.root,
      env: { ...sandbox.env, PATH: "/usr/bin:/bin" },
      stdout: "pipe",
      stderr: "pipe",
    })

    const helpOut = await new Response(help.stdout).text()

    expect(await help.exited).toBe(0)
    expect(helpOut).toContain("Space color:")

    const unknown = Bun.spawn([outfile, "nosuch"], {
      cwd: sandbox.root,
      env: sandbox.env,
      stdout: "pipe",
      stderr: "pipe",
    })

    const unknownErr = await new Response(unknown.stderr).text()

    expect(await unknown.exited).toBe(2)
    expect(unknownErr).toBe("unknown command 'nosuch'\n")

    const worker = Bun.spawn([outfile, "refresh-worker"], {
      cwd: sandbox.root,
      env: sandbox.env,
      stdout: "pipe",
      stderr: "pipe",
    })

    const workerErr = await new Response(worker.stderr).text()

    expect(await worker.exited).toBe(1)
    expect(workerErr).toContain("refresh-worker requires the socket generation from startup")
  }, 60_000)
})
