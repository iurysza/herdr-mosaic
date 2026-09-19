import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"

import { installFakeHerdr, makeSandbox } from "../support/sandbox.ts"

const repo = join(import.meta.dir, "..", "..")

const pythonCli = join(repo, "src", "main.py")

const tsCli = join(repo, "src", "cli.ts")

const USERS_REAL = `onboarding = false
# [ui]
# agent_panel_sort = "priority"

[theme]
# name = "one-dark"

name = "gruvbox"
auto_switch = false
[ui]
agent_panel_sort = "priority"
sidebar_width = 34

[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"]]


[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "herdr-file-viewer.open-file-viewer"
`

const SidebarState = Schema.Struct({
  sidebar_installed: Schema.optionalKey(Schema.Boolean),
  sidebar_backup: Schema.optionalKey(Schema.Struct({
    keys: Schema.JsonObject,
  })),
})

type CliKind = "python" | "typescript"

type CliRun = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

type PairEnv = {
  readonly python: { [key: string]: string }
  readonly typescript: { [key: string]: string }
}

function dropStamps(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} /g, "").replace(/^WARN /gm, "")
}

async function spawnCli(kind: CliKind, args: readonly string[], env: { [key: string]: string }): Promise<CliRun> {
  const argv = kind === "python"
    ? ["/usr/bin/python3", pythonCli, ...args]
    : [process.execPath, "--no-env-file", tsCli, ...args]

  const proc = Bun.spawn(argv, {
    cwd: repo,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited

  return { code, stdout, stderr }
}

function pairEnv(): PairEnv {
  const pythonSandbox = makeSandbox()
  const typescriptSandbox = makeSandbox()

  pythonSandbox.env.HERDR_BIN_PATH = installFakeHerdr(pythonSandbox)
  typescriptSandbox.env.HERDR_BIN_PATH = installFakeHerdr(typescriptSandbox)

  return { python: pythonSandbox.env, typescript: typescriptSandbox.env }
}

describe("python and typescript differential cases", () => {
  test("help, unknown, and plugin-id errors match in separate sandboxes", async () => {
    const pair = pairEnv()
    const helpPython = await spawnCli("python", ["--help"], pair.python)
    const helpTs = await spawnCli("typescript", ["--help"], pair.typescript)

    expect(helpPython.code).toBe(0)
    expect(helpTs).toEqual(helpPython)

    const unknownPython = await spawnCli("python", ["nosuch"], pair.python)
    const unknownTs = await spawnCli("typescript", ["nosuch"], pair.typescript)

    expect(unknownPython.code).toBe(2)
    expect(unknownTs).toEqual(unknownPython)

    const idPython = await spawnCli("python", ["doctor"], { ...pair.python, HERDR_PLUGIN_ID: "another.plugin" })

    const idTs = await spawnCli("typescript", ["doctor"], {
      ...pair.typescript,
      HERDR_PLUGIN_ID: "another.plugin",
    })

    expect(idPython.code).toBe(1)
    expect(idTs).toEqual(idPython)

    const workerPython = await spawnCli("python", ["refresh-worker"], pair.python)
    const workerTs = await spawnCli("typescript", ["refresh-worker"], pair.typescript)

    expect(workerPython.code).toBe(1)
    expect(dropStamps(workerTs.stderr)).toBe(dropStamps(workerPython.stderr))
    expect(workerTs.code).toBe(workerPython.code)
  })

  test("sidebar-install writes the same config bytes from the users_real fixture", async () => {
    const pair = pairEnv()
    const pythonConfig = pair.python.HERDR_CONFIG_PATH
    const tsConfig = pair.typescript.HERDR_CONFIG_PATH
    const pythonState = pair.python.HERDR_PLUGIN_STATE_DIR
    const tsState = pair.typescript.HERDR_PLUGIN_STATE_DIR

    if (
      pythonConfig === undefined || tsConfig === undefined
      || pythonState === undefined || tsState === undefined
    ) {
      throw new Error("missing sandbox paths")
    }

    await Bun.write(pythonConfig, USERS_REAL)
    await Bun.write(tsConfig, USERS_REAL)

    const python = await spawnCli("python", ["sidebar-install"], pair.python)
    const typescript = await spawnCli("typescript", ["sidebar-install"], pair.typescript)

    expect(python.code).toBe(0)
    expect(typescript.code).toBe(0)
    expect(dropStamps(typescript.stdout)).toBe(dropStamps(python.stdout))
    expect(readFileSync(tsConfig, "utf8")).toBe(readFileSync(pythonConfig, "utf8"))

    const pythonStateJson: unknown = JSON.parse(readFileSync(join(pythonState, "state.json"), "utf8"))
    const tsStateJson: unknown = JSON.parse(readFileSync(join(tsState, "state.json"), "utf8"))
    const pythonDecoded = Schema.decodeUnknownResult(SidebarState)(pythonStateJson)
    const tsDecoded = Schema.decodeUnknownResult(SidebarState)(tsStateJson)

    if (Result.isFailure(pythonDecoded) || Result.isFailure(tsDecoded)) {
      throw new Error("sidebar state was not a restore record")
    }

    expect(tsDecoded.success.sidebar_installed).toBe(true)
    expect(pythonDecoded.success.sidebar_installed).toBe(true)
    expect(tsDecoded.success.sidebar_backup?.keys).toEqual(pythonDecoded.success.sidebar_backup?.keys)
  })

  test("sidebar-remove without a backup is a noop in both runtimes", async () => {
    const pair = pairEnv()
    const python = await spawnCli("python", ["sidebar-remove"], pair.python)
    const typescript = await spawnCli("typescript", ["sidebar-remove"], pair.typescript)

    expect(python.code).toBe(0)
    expect(typescript).toEqual(python)
    expect(python.stdout).toContain("no sidebar backup recorded; nothing to remove")
  })
})
