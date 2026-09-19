import { join } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"

import { describe, expect, test } from "bun:test"
import { Clock, Effect, Result, Schema } from "effect"

import { runCli } from "../../src/cli.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { defaultState, load, save } from "../../src/state/store.ts"
import { workspaceIdOfPane } from "../../src/spaces/metadata.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { installFakeHerdr, makeSandbox } from "../support/sandbox.ts"

type Json = typeof Schema.Json.Type

type JsonObject = typeof Schema.JsonObject.Type

function clockAt(unixSeconds: number): Clock.Clock {
  const ms = unixSeconds * 1000

  return {
    currentTimeMillisUnsafe: () => ms,
    currentTimeMillis: Effect.sync(() => ms),
    monotonicTimeNanosUnsafe: () => BigInt(ms) * 1_000_000n,
    monotonicTimeNanos: Effect.sync(() => BigInt(ms) * 1_000_000n),
    currentTimeNanosUnsafe: () => BigInt(ms) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(ms) * 1_000_000n),
    sleep: () => Effect.never,
  }
}

async function run(
  argv: readonly string[],
  extraEnv: { [key: string]: string },
  unixSeconds?: number,
) {
  const previous = { ...process.env }

  Object.assign(process.env, extraEnv)

  try {
    let effect = runCli(argv).pipe(Effect.provide(PluginPaths.layer))

    if (unixSeconds !== undefined) {
      effect = effect.pipe(Effect.provideService(Clock.Clock, clockAt(unixSeconds)))
    }

    return await Effect.runPromise(effect)
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

function eventEnv(
  env: { [key: string]: string },
  name: string,
  payload: Json,
) {
  return {
    ...env,
    HERDR_PLUGIN_EVENT: name,
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify(payload),
  }
}

function statusPayload(paneId: string, status: string, extra: JsonObject = {}) {
  return {
    type: "pane_agent_status_changed",
    pane_id: paneId,
    workspace_id: "w1",
    agent_status: status,
    ...extra,
  }
}

function detectPayload(paneId: string, extra: JsonObject = {}) {
  return {
    type: "pane_agent_detected",
    pane_id: paneId,
    workspace_id: "w1",
    ...extra,
  }
}

function seedUnrelated(statePath: string) {
  const state = defaultState()

  state.identities = { w1: { colour: "#4f8cff", origin: "manual" } }
  state.tint_enabled = true
  state.last_written = { "theme.custom.accent": "#4f8cff" }
  state.view_installed = true
  save(statePath, state)

  return state
}

describe("workspaceIdOfPane", () => {
  test("uses the segment before the first colon", () => {
    expect(workspaceIdOfPane("w1:p1")).toBe("w1")
    expect(workspaceIdOfPane("w1")).toBe("w1")
    expect(workspaceIdOfPane(":p1")).toBeUndefined()
  })
})

describe("event CLI settled occupancy", () => {
  test("direct and envelope payloads record working then idle", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    seedUnrelated(statePath)

    const first = await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(sandbox.env, "pane.agent_status_changed", statusPayload("w1:p1", "working")),
      10,
    )

    const second = await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(
        sandbox.env,
        "pane.agent_status_changed",
        { event: "pane_agent_status_changed", data: statusPayload("w1:p1", "idle") },
      ),
      20,
    )

    expect(first.code).toBe(0)
    expect(second.code).toBe(0)
    expect(load(statePath).agent_settled["w1:p1"]).toEqual({
      status: "idle",
      last_settled_at: 20,
    })
  })

  test("optional themed fields are ignored and not written", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    const result = await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(
        sandbox.env,
        "pane.agent_status_changed",
        statusPayload("w1:p2", "working", {
          agent: "pi",
          display_agent: "Pi",
          title: "do not write",
          state_labels: { themed_model_tier: "high" },
        }),
      ),
      1,
    )

    expect(result.code).toBe(0)

    const rec = load(statePath).agent_settled["w1:p2"]

    expect(rec).toEqual({ status: "working", last_settled_at: 1 })
    expect(JSON.stringify(rec)).not.toContain("themed_model_tier")
    expect(JSON.stringify(rec)).not.toContain("title")
  })

  test("malformed status payloads write nothing", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const configPath = required(sandbox.env, "HERDR_CONFIG_PATH")

    writeFileSync(configPath, "onboarding = false\n")
    seedUnrelated(statePath)

    const before = readFileSync(statePath)
    const configBefore = readFileSync(configPath)

    const bad: Json[] = [
      {},
      { type: "pane_agent_status_changed" },
      { pane_id: "", agent_status: "idle" },
      { pane_id: "w1:p1", agent_status: "running" },
      { pane_id: "w1:p1", agent_status: null },
      { pane_id: ["w1:p1"], agent_status: "idle" },
      { pane_id: "w1:p1" },
      "not-an-object",
      { data: "nope" },
    ]

    for (const payload of bad) {
      const result = await run(
        ["event", "pane.agent_status_changed"],
        eventEnv(sandbox.env, "pane.agent_status_changed", payload),
        99,
      )

      expect(result.code).toBe(0)
    }

    expect(readFileSync(statePath)).toEqual(before)
    expect(readFileSync(configPath)).toEqual(configBefore)
  })

  test("duplicate settled events skip rewrite and keep unrelated state", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const configPath = required(sandbox.env, "HERDR_CONFIG_PATH")

    writeFileSync(configPath, "onboarding = false\n")
    seedUnrelated(statePath)

    await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(sandbox.env, "pane.agent_status_changed", statusPayload("w1:p1", "working")),
      10,
    )
    await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(sandbox.env, "pane.agent_status_changed", statusPayload("w1:p1", "idle")),
      11,
    )

    const afterIdle = readFileSync(statePath)

    await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(sandbox.env, "pane.agent_status_changed", statusPayload("w1:p1", "idle")),
      99,
    )

    const state = load(statePath)

    expect(state.agent_settled["w1:p1"]).toEqual({ status: "idle", last_settled_at: 11 })
    expect(state.identities.w1).toEqual({ colour: "#4f8cff", origin: "manual" })
    expect(state.tint_enabled).toBe(true)
    expect(state.last_written).toEqual({ "theme.custom.accent": "#4f8cff" })
    expect(state.view_installed).toBe(true)
    expect(readFileSync(statePath)).toEqual(afterIdle)
    expect(readFileSync(configPath).toString()).toBe("onboarding = false\n")
  })

  test("close and exit drop occupancy so reused pane ids start a new clock", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    seedUnrelated(statePath)
    await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(sandbox.env, "pane.agent_status_changed", statusPayload("w1:p1", "working")),
      10,
    )
    await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(sandbox.env, "pane.agent_status_changed", statusPayload("w1:p1", "idle")),
      11,
    )
    await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(sandbox.env, "pane.agent_status_changed", statusPayload("w1:p2", "working")),
      12,
    )

    expect((await run(
      ["event", "pane.closed"],
      eventEnv(sandbox.env, "pane.closed", {
        type: "pane_closed",
        pane_id: "w1:p1",
        workspace_id: "w1",
      }),
    )).code).toBe(0)

    let state = load(statePath)

    expect(state.agent_settled["w1:p1"]).toBeUndefined()
    expect(state.agent_settled["w1:p2"]).toEqual({ status: "working", last_settled_at: 12 })

    expect((await run(
      ["event", "pane.exited"],
      eventEnv(sandbox.env, "pane.exited", {
        type: "pane_exited",
        pane_id: "w1:p2",
        workspace_id: "w1",
      }),
    )).code).toBe(0)

    state = load(statePath)
    expect(state.agent_settled).toEqual({})
    expect(state.identities.w1).toEqual({ colour: "#4f8cff", origin: "manual" })

    await run(
      ["event", "pane.agent_status_changed"],
      eventEnv(sandbox.env, "pane.agent_status_changed", statusPayload("w1:p1", "idle")),
      12,
    )
    expect(load(statePath).agent_settled["w1:p1"]).toEqual({
      status: "idle",
      last_settled_at: 12,
    })
  })

  test("close without a record and missing pane id do not write", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    seedUnrelated(statePath)

    const before = readFileSync(statePath)

    expect((await run(
      ["event", "pane.closed"],
      eventEnv(sandbox.env, "pane.closed", {
        type: "pane_closed",
        pane_id: "missing",
        workspace_id: "w1",
      }),
    )).code).toBe(0)
    expect((await run(
      ["event", "pane.closed"],
      eventEnv(sandbox.env, "pane.closed", { type: "pane_closed" }),
    )).code).toBe(0)
    expect(readFileSync(statePath)).toEqual(before)
  })
})

describe("event CLI detection and workspace hooks", () => {
  test("detection initialises a clock once without status and released is ignored", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    fake.on("agent.list", () => ({ agents: [] }))
    await fake.listen()

    try {
      expect((await run(
        ["event", "pane.agent_detected"],
        eventEnv(sandbox.env, "pane.agent_detected", detectPayload("w1:p1")),
        10,
      )).code).toBe(0)
      expect(load(statePath).agent_settled["w1:p1"]).toEqual({
        status: null,
        last_settled_at: 10,
      })

      const afterFirst = readFileSync(statePath)

      expect((await run(
        ["event", "pane.agent_detected"],
        eventEnv(
          sandbox.env,
          "pane.agent_detected",
          { event: "pane_agent_detected", data: detectPayload("w1:p1") },
        ),
        99,
      )).code).toBe(0)
      expect(load(statePath).agent_settled["w1:p1"]).toEqual({
        status: null,
        last_settled_at: 10,
      })
      expect(readFileSync(statePath)).toEqual(afterFirst)

      expect((await run(
        ["event", "pane.agent_detected"],
        eventEnv(
          sandbox.env,
          "pane.agent_detected",
          detectPayload("w1:p2", { released: true, final_status: "idle" }),
        ),
        10,
      )).code).toBe(0)
      expect(load(statePath).agent_settled["w1:p2"]).toBeUndefined()
    } finally {
      await fake.close()
    }
  })

  test("moved does not initialise a clock; agent panes republish identity", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.identities = { w1: { colour: "#7aa2f7", origin: "manual" } }
    save(statePath, state)

    fake.on("agent.list", () => ({ agents: [] }))
    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w1", label: "Website" }],
    }))
    fake.on("pane.report_metadata", () => ({}))
    await fake.listen()

    try {
      expect((await run(
        ["event", "pane.moved"],
        eventEnv(sandbox.env, "pane.moved", {
          type: "pane_moved",
          previous_pane_id: "old",
          pane: { pane_id: "w1:p1" },
        }),
        10,
      )).code).toBe(0)
      expect(load(statePath).agent_settled).toEqual({})

      fake.on("agent.list", () => ({ agents: [{ pane_id: "w1:p1", workspace_id: "w1" }] }))

      const moved = await run(
        ["event", "pane.moved"],
        eventEnv(sandbox.env, "pane.moved", {
          type: "pane_moved",
          pane: { pane_id: "w1:p1" },
        }),
      )

      expect(moved.code).toBe(0)
      expect(moved.stdout).toContain("pane w1:p1 moved; identity now azure")
      expect(fake.requests.some((request) => request.method === "pane.report_metadata")).toBe(true)
    } finally {
      await fake.close()
    }
  })

  test("workspace.closed keeps identity and clears matching last_tint", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.identities = { w1: { colour: "#4f8cff", origin: "manual" } }
    state.last_tint = { workspace_id: "w1", values: { accent: "#4f8cff" } }
    save(statePath, state)

    const result = await run(
      ["event", "workspace.closed"],
      eventEnv(sandbox.env, "workspace.closed", { workspace_id: "w1" }),
    )

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("workspace w1 closed; identity retained")

    const loaded = load(statePath)

    expect(loaded.identities.w1).toEqual({ colour: "#4f8cff", origin: "manual" })
    expect(loaded.last_tint).toBeNull()
  })

  test("workspace.focused uses live focused workspace and skips payload", async () => {
    const sandbox = makeSandbox()
    const herdr = installFakeHerdr(sandbox)

    sandbox.env.HERDR_BIN_PATH = herdr

    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.identities = { live: { colour: "#7aa2f7", origin: "manual" } }
    save(statePath, state)
    writeFileSync(required(sandbox.env, "HERDR_CONFIG_PATH"), "[theme]\nname = \"nord\"\n")

    fake.on("workspace.list", () => ({
      workspaces: [
        { workspace_id: "payload", label: "From payload", focused: false },
        { workspace_id: "live", label: "Live space", focused: true },
      ],
    }))
    fake.on("agent.list", () => ({ agents: [] }))
    fake.on("client.window_title.set", () => ({}))
    fake.on("workspace.report_metadata", () => ({}))
    fake.on("tab.list", () => ({ tabs: [] }))
    await fake.listen()

    try {
      const result = await run(
        ["event", "workspace.focused"],
        eventEnv(sandbox.env, "workspace.focused", { workspace_id: "payload" }),
      )

      expect(result.code).toBe(0)

      const loaded = load(statePath)
      const lastTint = Schema.decodeUnknownResult(Schema.JsonObject)(loaded.last_tint)

      expect(Result.isSuccess(lastTint) ? lastTint.success.workspace_id : undefined).toBe("live")
      expect(fake.requests.some((request) =>
        request.method === "client.window_title.set"
        && JSON.stringify(request.params).includes("Live space")
      )).toBe(true)
      expect(JSON.stringify(fake.requests)).not.toContain("From payload")
    } finally {
      await fake.close()
    }
  })

  test("workspace.created assigns identity; unhandled events warn and exit 0", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w9", number: 9, label: "New" }],
    }))
    fake.on("agent.list", () => ({ agents: [] }))
    fake.on("workspace.report_metadata", () => ({}))
    await fake.listen()

    try {
      const created = await run(
        ["event", "workspace.created"],
        eventEnv(sandbox.env, "workspace.created", { workspace_id: "w9" }),
      )

      expect(created.code).toBe(0)
      expect(created.stdout).toContain("workspace w9 created; identity")
      expect(load(statePath).identities.w9).toMatchObject({ origin: "auto" })
      expect(fake.requests.some((request) => request.method === "workspace.report_metadata")).toBe(true)

      const unhandled = await run(
        ["event", "session.mystery"],
        eventEnv(sandbox.env, "session.mystery", {}),
      )

      expect(unhandled.code).toBe(0)
      expect(unhandled.stderr).toContain("unhandled event 'session.mystery'")
    } finally {
      await fake.close()
    }
  })

  test("label apply publishes the other matching workspace", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const rulesPath = join(sandbox.root, "rules.json")

    writeFileSync(rulesPath, JSON.stringify({
      version: 1,
      identities: { agents: "sage", api: "peach" },
    }))
    fake.on("workspace.list", () => ({
      workspaces: [
        { workspace_id: "w1", label: "agents" },
        { workspace_id: "w2", label: "api" },
      ],
    }))
    fake.on("agent.list", () => ({ agents: [] }))
    fake.on("workspace.report_metadata", () => ({}))
    await fake.listen()

    try {
      const result = await run(
        ["event", "workspace.created"],
        {
          ...eventEnv(sandbox.env, "workspace.created", { workspace_id: "w1" }),
          HERDR_LABEL_IDENTITIES_FILE: rulesPath,
        },
      )

      expect(result.code).toBe(0)

      const published = fake.requests
        .filter((request) => request.method === "workspace.report_metadata")
        .map((request) => request.params.workspace_id)
        .sort()

      expect(published).toEqual(["w1", "w2"])
      expect(load(statePath).identities.w1).toEqual({ colour: "#a6d189", origin: "label" })
      expect(load(statePath).identities.w2).toEqual({ colour: "#fab387", origin: "label" })
    } finally {
      await fake.close()
    }
  })

  test("workspace.renamed keeps identity and republishes agent panes", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.identities = { w1: { colour: "#7aa2f7", origin: "manual" } }
    save(statePath, state)

    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w1", label: "Renamed" }],
    }))
    fake.on("agent.list", () => ({ agents: [{ pane_id: "w1:p1", workspace_id: "w1" }] }))
    fake.on("workspace.report_metadata", () => ({}))
    fake.on("pane.report_metadata", () => ({}))
    await fake.listen()

    try {
      const result = await run(
        ["event", "workspace.renamed"],
        eventEnv(sandbox.env, "workspace.renamed", { workspace_id: "w1" }),
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("workspace w1 renamed to 'Renamed'; identity azure unchanged")
      expect(load(statePath).identities.w1).toEqual({ colour: "#7aa2f7", origin: "manual" })
      expect(fake.requests.some((request) => request.method === "workspace.report_metadata")).toBe(true)
      expect(fake.requests.some((request) => request.method === "pane.report_metadata")).toBe(true)
    } finally {
      await fake.close()
    }
  })

  test("tab.renamed is a no-op handler", async () => {
    const sandbox = makeSandbox()
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    seedUnrelated(statePath)

    const before = readFileSync(statePath)

    const result = await run(
      ["event", "tab.renamed"],
      eventEnv(sandbox.env, "tab.renamed", { tab_id: "t1" }),
    )

    expect(result.code).toBe(0)
    expect(readFileSync(statePath)).toEqual(before)
  })
})
