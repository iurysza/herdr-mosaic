import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { defaultState, load, save } from "../../src/state/store.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

const driver = join(import.meta.dir, "..", "support", "pty-drive.py")

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts")

function required(env: { [key: string]: string }, key: string): string {
  const value = env[key]

  if (value === undefined || value === "") throw new Error(`missing ${key}`)

  return value
}

function childEnv(sandboxEnv: { [key: string]: string }) {
  return {
    ...process.env,
    ...sandboxEnv,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "xterm-256color",
  }
}

type DriveStep =
  | { readonly wait: string }
  | { readonly send: string }
  | { readonly send_bytes: string }
  | { readonly resize: readonly [number, number] }
  | { readonly sleep_ms: number }

async function drive(
  sandboxEnv: { [key: string]: string },
  argv: readonly string[],
  script: readonly DriveStep[],
) {
  const proc = Bun.spawn(
    [
      "python3",
      driver,
      "--script",
      JSON.stringify(script),
      "--",
      process.execPath,
      "--no-env-file",
      cli,
      ...argv,
    ],
    {
      env: childEnv(sandboxEnv),
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited

  return { code, stdout, stderr }
}

describe("interactive TUI over a PTY", () => {
  test("picker q cancels, redraws after resize, and restores the cursor", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w1", label: "agents", focused: true }],
    }))
    await fake.listen()

    try {
      const result = await drive(
        { ...sandbox.env, SPACE_IDENTITY_TARGET: "w1" },
        ["picker"],
        [
          { wait: "Space color:" },
          { resize: [12, 40] },
          { sleep_ms: 80 },
          { send: "q" },
        ],
      )

      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain("Space color: agents (w1)")
      expect(result.stdout).toContain("cancelled")
      expect(result.stdout).toContain("\u001b[0m\u001b[?25h")
    } finally {
      await fake.close()
    }
  }, 10_000)

  test("board q quits after showing grouped agents", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w1", number: 1, label: "Web" }],
    }))
    fake.on("agent.list", () => ({
      agents: [{
        pane_id: "w1:p1",
        workspace_id: "w1",
        agent_status: "idle",
        agent: "pi",
      }],
    }))
    await fake.listen()

    try {
      const result = await drive(sandbox.env, ["board"], [
        { wait: "Workspace Agent Board" },
        { send: "q" },
      ])

      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain("Web")
      expect(result.stdout).toContain("\u001b[0m\u001b[?25h")
    } finally {
      await fake.close()
    }
  }, 10_000)

  test("prune q cancels without closing panes", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w1", label: "Agent team" }],
    }))
    fake.on("tab.list", () => ({ tabs: [{ tab_id: "w1:t1", label: "Build" }] }))
    fake.on("agent.list", () => ({ agents: [] }))
    await fake.listen()

    try {
      const result = await drive(sandbox.env, ["prune"], [
        { wait: "Prune stale agent sessions" },
        { send: "q" },
      ])

      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain("Prune stale agent sessions")
      expect(result.stdout).toContain("\u001b[0m\u001b[?25h")
      expect(fake.requests.some((request) => request.method === "pane.close")).toBe(false)
    } finally {
      await fake.close()
    }
  }, 10_000)

  test("pane-move q cancels the pending selection", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.pending_pane_move = { pane_id: "w1:p1" }
    save(statePath, state)
    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w1", label: "Web" }],
    }))
    fake.on("pane.list", () => ({
      panes: [
        {
          pane_id: "w1:p1",
          workspace_id: "w1",
          tab_id: "w1:t1",
          terminal_title_stripped: "Source",
        },
        {
          pane_id: "w2:p2",
          workspace_id: "w2",
          tab_id: "w2:t2",
          terminal_title_stripped: "Destination",
        },
      ],
    }))
    await fake.listen()

    try {
      const result = await drive(
        {
          ...sandbox.env,
          MOSAIC_PANE_MOVE_SOURCE: "w1:p1",
          MOSAIC_PANE_MOVE_DESTINATION: "w2:p2",
        },
        ["pane-move"],
        [
          { wait: "FROM" },
          { send: "q" },
        ],
      )

      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain("Source")
      expect(result.stdout).toContain("Destination")
      expect(result.stdout).toContain("[S]")
      expect(result.stdout).toContain("\u001b[0m\u001b[?25h")

      expect(load(statePath).pending_pane_move).toBeNull()
    } finally {
      await fake.close()
    }
  }, 10_000)
})
