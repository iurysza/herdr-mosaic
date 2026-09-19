import { spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { PLUGIN_ID } from "../../src/ids.ts"
import { readSocketGeneration } from "../../src/runtime/worker.ts"
import { load } from "../../src/state/store.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { installFakeHerdr, makeSandbox } from "../support/sandbox.ts"

const repo = join(import.meta.dir, "..", "..")

const cli = join(repo, "src", "cli.ts")

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

function spawnCli(env: { [key: string]: string }, args: readonly string[]) {
  return spawn(process.execPath, ["--no-env-file", cli, ...args], {
    env: { ...process.env, ...env },
    cwd: repo,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function spawnHelper(env: { [key: string]: string }, script: string, args: readonly string[]) {
  return spawn(process.execPath, [join(import.meta.dir, script), ...args], {
    env: { ...process.env, ...env },
    cwd: repo,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function required(env: { [key: string]: string }, key: string): string {
  const value = env[key]

  if (value === undefined || value === "") throw new Error(`missing ${key}`)

  return value
}

function statusEnv(env: { [key: string]: string }, paneId: string, status: string) {
  return {
    ...env,
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      type: "pane_agent_status_changed",
      pane_id: paneId,
      workspace_id: "w1",
      agent_status: status,
    }),
  }
}

describe("stress integration boundaries", () => {
  test("overlapping status hooks serialize under the plugin lock", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    const first = spawnCli(
      statusEnv(sandbox.env, "w1:p1", "working"),
      ["event", "pane.agent_status_changed"],
    )

    const second = spawnCli(
      statusEnv(sandbox.env, "w1:p2", "idle"),
      ["event", "pane.agent_status_changed"],
    )

    const results = await Promise.all([waitExit(first), waitExit(second)])

    expect(results[0]?.code).toBe(0)
    expect(results[1]?.code).toBe(0)

    const state = load(statePath)

    expect(state.agent_settled["w1:p1"]).toEqual(expect.objectContaining({ status: "working" }))
    expect(state.agent_settled["w1:p2"]).toEqual(expect.objectContaining({ status: "idle" }))
    JSON.parse(await Bun.file(statePath).text())
  }, 15_000)

  test("an interrupted waiter leaves the lock free for the next mutation", async () => {
    const sandbox = makeSandbox()
    const stateDir = required(sandbox.env, "HERDR_PLUGIN_STATE_DIR")

    const holder = spawnHelper(sandbox.env, "hold-lock.ts", ["4000", "5000"])

    await new Promise<void>((resolve) => {
      holder.stdout?.on("data", () => resolve())
    })

    const waiter = spawnCli(
      statusEnv(sandbox.env, "w1:p1", "working"),
      ["event", "pane.agent_status_changed"],
    )

    await Bun.sleep(80)
    expect(waiter.exitCode).toBeNull()
    waiter.kill("SIGKILL")
    await waitExit(waiter)
    holder.kill("SIGKILL")
    await waitExit(holder)

    const next = spawnCli(
      statusEnv(sandbox.env, "w1:p2", "idle"),
      ["event", "pane.agent_status_changed"],
    )

    const result = await waitExit(next)

    expect(result.code).toBe(0)
    expect(load(join(stateDir, "state.json")).agent_settled["w1:p2"]).toEqual(
      expect.objectContaining({ status: "idle" }),
    )
  }, 15_000)

  test("a lock holder makes overlapping events wait, then both land", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    const holder = spawnHelper(sandbox.env, "hold-lock.ts", ["250", "2000"])

    await new Promise<void>((resolve) => {
      holder.stdout?.on("data", () => resolve())
    })

    const first = spawnCli(
      statusEnv(sandbox.env, "w1:a", "working"),
      ["event", "pane.agent_status_changed"],
    )

    const second = spawnCli(
      statusEnv(sandbox.env, "w1:b", "done"),
      ["event", "pane.agent_status_changed"],
    )

    const results = await Promise.all([waitExit(first), waitExit(second), waitExit(holder)])

    expect(results[0]?.code).toBe(0)
    expect(results[1]?.code).toBe(0)

    const settled = load(statePath).agent_settled

    expect(settled["w1:a"]).toEqual(expect.objectContaining({ status: "working" }))
    expect(settled["w1:b"]).toEqual(expect.objectContaining({ status: "done" }))
  }, 15_000)

  test("startRefreshWorker does not spawn while the generation lock is held", async () => {
    const sandbox = makeSandbox()
    const socketPath = required(sandbox.env, "HERDR_SOCKET_PATH")
    const fake = new FakeHerdr(socketPath)

    fake.on("plugin.list", () => ({
      plugins: [{
        plugin_id: PLUGIN_ID,
        enabled: true,
        plugin_root: repo,
      }],
    }))
    await fake.listen()
    writeFileSync(
      join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json"),
      JSON.stringify({ sidebar_installed: true }),
    )

    const key = readSocketGeneration(socketPath)

    const holder = spawnHelper(sandbox.env, "hold-worker.ts", [key, "2000"])

    await new Promise<void>((resolve) => {
      holder.stdout?.on("data", () => resolve())
    })

    try {
      const first = spawnHelper(sandbox.env, "start-worker.ts", [cli])

      const second = spawnHelper(sandbox.env, "start-worker.ts", [cli])

      const results = await Promise.all([waitExit(first), waitExit(second)])

      expect(results[0]?.stdout).toContain("pid:0")
      expect(results[1]?.stdout).toContain("pid:0")
    } finally {
      holder.kill("SIGKILL")
      await waitExit(holder)
      await fake.close()
    }
  }, 15_000)

  test("a refresh worker exits without publishing after the socket is replaced", async () => {
    const sandbox = makeSandbox()
    const socketPath = required(sandbox.env, "HERDR_SOCKET_PATH")
    const fake = new FakeHerdr(socketPath)
    const published: string[] = []

    fake.on("plugin.list", () => ({
      plugins: [{
        plugin_id: PLUGIN_ID,
        enabled: true,
        plugin_root: repo,
      }],
    }))
    fake.on("agent.list", () => ({ agents: [{ pane_id: "w1:p1" }] }))
    fake.on("pane.report_metadata", () => {
      published.push("pane.report_metadata")

      return {}
    })
    fake.on("workspace.list", () => ({ workspaces: [] }))
    fake.on("tab.list", () => ({ tabs: [] }))
    await fake.listen()

    writeFileSync(
      join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json"),
      JSON.stringify({ sidebar_installed: true }),
    )

    try {
      const liveKey = readSocketGeneration(socketPath)

      const worker = spawnCli(sandbox.env, ["refresh-worker", `${liveKey}:replaced`])

      const result = await waitExit(worker)

      expect(result.code).toBe(0)
      expect(published).toEqual([])
      expect(fake.requests.some((request) => request.method === "pane.report_metadata")).toBe(false)
    } finally {
      await fake.close()
    }
  }, 15_000)

  test("an overlapping event keeps an external config edit", async () => {
    const sandbox = makeSandbox()
    const herdr = installFakeHerdr(sandbox)

    sandbox.env.HERDR_BIN_PATH = herdr
    const configPath = required(sandbox.env, "HERDR_CONFIG_PATH")
    const edited = `onboarding = false\n\n[theme]\nname = "user-edit"\n`

    writeFileSync(configPath, "[theme]\nname = \"gruvbox\"\n")

    const holder = spawnHelper(sandbox.env, "hold-lock.ts", ["200", "2000"])

    await new Promise<void>((resolve) => {
      holder.stdout?.on("data", () => resolve())
    })
    writeFileSync(configPath, edited)

    const event = spawnCli(
      statusEnv(sandbox.env, "w1:p1", "working"),
      ["event", "pane.agent_status_changed"],
    )

    const results = await Promise.all([waitExit(event), waitExit(holder)])

    expect(results[0]?.code).toBe(0)
    expect(readFileSync(configPath, "utf8")).toBe(edited)
    expect(load(join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")).agent_settled["w1:p1"])
      .toEqual(expect.objectContaining({ status: "working" }))
  }, 15_000)

})
