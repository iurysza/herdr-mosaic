import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { installFakeHerdr, makeSandbox, type Sandbox } from "../support/sandbox.ts"

const fakeBin = join(import.meta.dir, "..", "support", "fake-herdr-bin.ts")

type Captured = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

async function spawnCaptured(
  cmd: readonly string[],
  env: Sandbox["env"],
): Promise<Captured> {
  const proc = Bun.spawn([...cmd], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited

  return { code, stdout, stderr }
}

function writeConfig(sandbox: Sandbox, text: string): void {
  const path = sandbox.env.HERDR_CONFIG_PATH

  if (path === undefined) throw new Error("sandbox is missing HERDR_CONFIG_PATH")

  writeFileSync(path, text)
}

describe("fake Herdr executable", () => {
  test("records argv and answers --version without touching a live binary", async () => {
    const sandbox = makeSandbox()
    const logPath = join(sandbox.root, "fake-herdr.log")

    const captured = await spawnCaptured(
      [process.execPath, fakeBin, "--version"],
      { ...sandbox.env, MOSAIC_FAKE_HERDR_LOG: logPath, HERDR_BIN_PATH: fakeBin },
    )

    expect(captured.code).toBe(0)
    expect(captured.stdout).toContain("herdr 0.0-fake")
    expect(await Bun.file(logPath).text()).toContain("--version")
  })

  test("config check prints ok for a valid file, including empty", async () => {
    const sandbox = makeSandbox()

    writeConfig(sandbox, "")

    const empty = await spawnCaptured(
      [process.execPath, fakeBin, "config", "check"],
      sandbox.env,
    )

    expect(empty.code).toBe(0)
    expect(empty.stdout).toBe("ok\n")

    writeConfig(sandbox, '[theme]\nname = "gruvbox"\n')

    const ok = await spawnCaptured(
      [process.execPath, fakeBin, "config", "check"],
      sandbox.env,
    )

    expect(ok.code).toBe(0)
    expect(ok.stdout).toBe("ok\n")
  })

  test("config check rejects not_a_real_token with a non-summary diagnostic", async () => {
    const sandbox = makeSandbox()

    writeConfig(sandbox, '[theme]\nname = "gruvbox"\nrows = ["not_a_real_token"]\n')

    const captured = await spawnCaptured(
      [process.execPath, fakeBin, "config", "check"],
      sandbox.env,
    )

    expect(captured.code).toBe(1)
    expect(captured.stdout).toContain("unknown token not_a_real_token")
    expect(captured.stdout).not.toContain("config: ")
  })

  test("config check rejects legacy_unknown_key with a baseline diagnostic", async () => {
    const sandbox = makeSandbox()

    writeConfig(sandbox, '[theme]\nname = "gruvbox"\nlegacy_unknown_key = 1\n')

    const captured = await spawnCaptured(
      [process.execPath, fakeBin, "config", "check"],
      sandbox.env,
    )

    expect(captured.code).toBe(1)
    expect(captured.stdout).toContain("unknown key legacy_unknown_key")
    expect(captured.stdout).not.toContain("config: ")
  })

  test("config check reports parse errors for missing, unreadable, and broken files", async () => {
    const missingPath = makeSandbox()

    const missing = await spawnCaptured(
      [process.execPath, fakeBin, "config", "check"],
      { ...missingPath.env, HERDR_CONFIG_PATH: "" },
    )

    expect(missing.code).toBe(1)
    expect(missing.stdout).toContain("config parse error")

    const unreadable = makeSandbox()

    const unread = await spawnCaptured(
      [process.execPath, fakeBin, "config", "check"],
      unreadable.env,
    )

    expect(unread.code).toBe(1)
    expect(unread.stdout).toContain("config parse error")

    const broken = makeSandbox()

    writeConfig(broken, "[theme")

    const parse = await spawnCaptured(
      [process.execPath, fakeBin, "config", "check"],
      broken.env,
    )

    expect(parse.code).toBe(1)
    expect(parse.stdout).toContain("config parse error")
  })

  test("wrapper is executable via spawn without bun on PATH", async () => {
    const sandbox = makeSandbox()

    writeConfig(sandbox, '[theme]\nname = "gruvbox"\n')

    const wrapper = installFakeHerdr(sandbox)

    const captured = await spawnCaptured(
      [wrapper, "config", "check"],
      { ...sandbox.env, PATH: "/usr/bin:/bin", HERDR_BIN_PATH: wrapper },
    )

    expect(captured.code).toBe(0)
    expect(captured.stdout).toBe("ok\n")
    expect(captured.stderr).toBe("")
  })
})
