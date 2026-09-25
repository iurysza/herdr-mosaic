import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { closeSelected } from "../../src/agents/triage.ts"
import { runCli } from "../../src/cli.ts"
import { PLUGIN_ID } from "../../src/ids.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { defaultState, load, save } from "../../src/state/store.ts"
import type { JsonObject } from "../../src/runtime/rpc.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

async function run(argv: readonly string[], extraEnv: { [key: string]: string }) {
  const previous = { ...process.env }

  Object.assign(process.env, extraEnv)

  try {
    return await Effect.runPromise(runCli(argv).pipe(Effect.provide(PluginPaths.layer)))
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key]
    }

    Object.assign(process.env, previous)
  }
}

function required(env: { [key: string]: string }, key: string): string {
  const value = env[key]

  if (value === undefined || value === "") throw new Error(`missing ${key}`)

  return value
}

function agent(paneId: string, status = "idle", focused = false): JsonObject {
  const record: JsonObject = {
    pane_id: paneId,
    agent_status: status,
    agent: "pi",
    terminal_title_stripped: `Task ${paneId}`,
    workspace_id: "w1",
    tab_id: "w1:t1",
  }

  if (focused) return { ...record, focused: true }

  return record
}

describe("next-idle-agent CLI", () => {
  test("focuses the first eligible agent and remembers the activity head", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.agent_settled = {
      p1: { status: "idle", last_settled_at: 20 },
      p2: { status: "done", last_settled_at: 10 },
      "p-blocked": { status: "blocked", last_settled_at: 1, last_blocked_at: 4 },
    }
    save(statePath, state)

    fake.on("agent.list", () => ({
      agents: [
        agent("p1"),
        agent("p2", "done"),
        { ...agent("p-blocked", "blocked"), workspace_id: "w2" },
      ],
    }))
    fake.on("agent.focus", () => ({}))
    await fake.listen()

    try {
      const result = await run(["next-idle-agent"], sandbox.env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("focused next eligible agent (newest-first): Task p-blocked")
      expect(fake.requests.some((request) =>
        request.method === "agent.focus" && request.params.target === "p-blocked"
      )).toBe(true)
      expect(load(statePath).idle_navigation_heads).toEqual({ newest: '["p-blocked","blocked",4]' })
    } finally {
      await fake.close()
    }
  })

  test("does not focus when the only eligible agent is already focused", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.agent_settled = { p1: { status: "idle", last_settled_at: 20 } }
    save(statePath, state)

    fake.on("agent.list", () => ({ agents: [agent("p1", "idle", true)] }))
    fake.on("agent.focus", () => ({}))
    await fake.listen()

    try {
      const result = await run(["next-idle-agent"], sandbox.env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("no other eligible agent is available")
      expect(fake.requests.some((request) => request.method === "agent.focus")).toBe(false)
    } finally {
      await fake.close()
    }
  })

  test("does not write the cursor when focus fails", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.agent_settled = { p1: { status: "idle", last_settled_at: 20 } }
    save(statePath, state)

    fake.on("agent.list", () => ({ agents: [agent("p1")] }))
    fake.on("agent.focus", () => ({ error: { code: "unavailable", message: "nope" } }))
    await fake.listen()

    try {
      const result = await run(["next-idle-agent"], sandbox.env)

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("could not focus newest-first eligible agent p1")
      expect(load(statePath).idle_navigation_heads).toEqual({})
    } finally {
      await fake.close()
    }
  })

  test("prints a message when no eligible agent is available", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("agent.list", () => ({ agents: [] }))
    await fake.listen()

    try {
      const result = await run(["next-idle-agent"], sandbox.env)

      expect(result.code).toBe(0)
      expect(result.stdout).toBe("no other eligible agent is available\n")
    } finally {
      await fake.close()
    }
  })

  test("oldest-idle-agent focuses the other end of the same list", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.agent_settled = {
      p1: { status: "idle", last_settled_at: 20 },
      p2: { status: "done", last_settled_at: 10 },
    }
    save(statePath, state)

    fake.on("agent.list", () => ({ agents: [agent("p1"), agent("p2", "done")] }))
    fake.on("agent.focus", () => ({}))
    await fake.listen()

    try {
      const result = await run(["oldest-idle-agent"], sandbox.env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("focused next eligible agent (oldest-first): Task p2")
      expect(fake.requests.some((request) =>
        request.method === "agent.focus" && request.params.target === "p2"
      )).toBe(true)
    } finally {
      await fake.close()
    }
  })

  for (const [command, expected] of [
    ["next-idle-agent", ["p1", "p2", "p3", "p1"]],
    ["oldest-idle-agent", ["p3", "p2", "p1", "p3"]],
  ] as const) {
    test(`${command} advances on every press and wraps using live focus`, async () => {
      const sandbox = makeSandbox()
      const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
      const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
      let focused = "shell"
      const visited: string[] = []

      fake.on("agent.list", () => ({ agents: [
        { ...agent("p1", "idle", focused === "p1"), state_change_seq: 30 },
        { ...agent("p2", "done", focused === "p2"), state_change_seq: 20 },
        { ...agent("p3", "idle", focused === "p3"), state_change_seq: 10 },
      ] }))
      fake.on("agent.focus", (_method, params) => {
        focused = String(params.target)
        visited.push(focused)

        return {}
      })
      await fake.listen()

      try {
        for (const target of expected) {
          expect((await run([command], sandbox.env)).code).toBe(0)
          expect(focused).toBe(target)
        }

        expect(visited).toEqual([...expected])
        expect(load(statePath).idle_navigation_heads).not.toEqual({})
      } finally {
        await fake.close()
      }
    })
  }

  test("a newly updated agent at the front interrupts the walk, then cycling resumes", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    let focused = "shell"
    let fourthStatus = "working"
    let fourthSequence = 5
    let firstSequence = 30
    let failFocus = false

    fake.on("agent.list", () => ({ agents: [
      { ...agent("p1", "idle", focused === "p1"), state_change_seq: firstSequence },
      { ...agent("p2", "done", focused === "p2"), state_change_seq: 20 },
      { ...agent("p3", "idle", focused === "p3"), state_change_seq: 10 },
      { ...agent("p4", fourthStatus, focused === "p4"), state_change_seq: fourthSequence },
    ] }))
    fake.on("agent.focus", (_method, params): JsonObject => {
      if (failFocus) return { error: { code: "unavailable", message: "retry" } }

      focused = String(params.target)

      return {}
    })
    await fake.listen()

    try {
      for (const target of ["p1", "p2", "p3"]) {
        expect((await run(["next-idle-agent"], sandbox.env)).code).toBe(0)
        expect(focused).toBe(target)
      }

      fourthStatus = "idle"
      fourthSequence = 40
      failFocus = true
      const beforeFailure = load(statePath).idle_navigation_heads

      expect((await run(["next-idle-agent"], sandbox.env)).code).toBe(1)
      expect(load(statePath).idle_navigation_heads).toEqual(beforeFailure)
      failFocus = false

      for (const target of ["p4", "p1", "p2"]) {
        expect((await run(["next-idle-agent"], sandbox.env)).code).toBe(0)
        expect(focused).toBe(target)
      }

      firstSequence = 50
      expect((await run(["next-idle-agent"], sandbox.env)).code).toBe(0)
      expect(focused).toBe("p1")
      expect((await run(["next-idle-agent"], sandbox.env)).code).toBe(0)
      expect(focused).toBe("p4")

      // External focus is the anchor; the saved head is not a saved position.
      focused = "p1"
      expect((await run(["next-idle-agent"], sandbox.env)).code).toBe(0)
      expect(focused).toBe("p4")
    } finally {
      await fake.close()
    }
  })

  test("extra argv exits 1", async () => {
    const sandbox = makeSandbox()
    const result = await run(["next-idle-agent", "extra"], sandbox.env)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("usage: next-idle-agent")
  })
})

describe("prune-stale-agents CLI", () => {
  test("opens the pruner and protects the agent focused before the popup", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("agent.list", () => ({ agents: [agent("p1", "idle", true), agent("p2")] }))
    fake.on("plugin.pane.open", () => ({}))
    await fake.listen()

    try {
      const result = await run(["prune-stale-agents"], sandbox.env)

      expect(result.code).toBe(0)

      const opened = fake.requests.find((request) => request.method === "plugin.pane.open")

      expect(opened?.params.plugin_id).toBe(PLUGIN_ID)
      expect(opened?.params.entrypoint).toBe("prune")
      expect(opened?.params.focus).toBe(true)
      expect(opened?.params.placement).toBe("popup")
      expect(opened?.params.env).toEqual({ MOSAIC_PRUNE_PROTECTED_PANE: "p1" })
    } finally {
      await fake.close()
    }
  })

  test("closeSelected rechecks eligibility before closing", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.agent_settled = {
      "p-old": { status: "idle", last_settled_at: 1 },
      "p-now-working": { status: "idle", last_settled_at: 1 },
    }
    save(statePath, state)

    fake.on("agent.list", () => ({
      agents: [agent("p-old", "idle"), agent("p-now-working", "working")],
    }))
    fake.on("pane.close", () => ({}))
    await fake.listen()

    const previous = { ...process.env }

    Object.assign(process.env, sandbox.env)

    try {
      const outcome = await Effect.runPromise(
        Effect.gen(function*() {
          const paths = yield* PluginPaths

          return yield* closeSelected(paths, ["p-old", "p-now-working"], 100, undefined, 1000)
        }).pipe(Effect.provide(PluginPaths.layer)),
      )

      expect(outcome.closed).toEqual(["p-old"])
      expect(outcome.skipped).toEqual(["p-now-working"])
      expect(outcome.failures).toEqual([])

      const closes = fake.requests.filter((request) => request.method === "pane.close")

      expect(closes.length).toBe(1)
      expect(closes[0]?.params).toEqual({ pane_id: "p-old" })
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }

      Object.assign(process.env, previous)
      await fake.close()
    }
  })
})
