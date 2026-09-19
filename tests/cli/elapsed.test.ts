import { join } from "node:path"
import { readFileSync } from "node:fs"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { ELAPSED_BLANK, fitWidth } from "../../src/agents/elapsed.ts"
import { runCli } from "../../src/cli.ts"
import { ELAPSED_SOURCE, ELAPSED_TTL_MS, TITLE_SOURCE } from "../../src/ids.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { defaultState, save } from "../../src/state/store.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

async function run(argv: readonly string[], env: { [key: string]: string }) {
  const previous = { ...process.env }

  Object.assign(process.env, env)

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

describe("elapsed-publish CLI", () => {
  test("publishes elapsed tokens only and does not write state", async () => {
    const sandbox = makeSandbox()
    const socketPath = required(sandbox.env, "HERDR_SOCKET_PATH")
    const fake = new FakeHerdr(socketPath)
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.agent_settled = { p1: { status: "idle", last_settled_at: Math.floor(Date.now() / 1000) - 120 } }
    save(statePath, state)

    const before = readFileSync(statePath)

    fake.on("agent.list", () => ({ agents: [{ pane_id: "p1" }, { pane_id: "p2" }] }))
    fake.on("pane.report_metadata", () => ({}))

    await fake.listen()

    try {
      const result = await run(["elapsed-publish"], sandbox.env)

      expect(result.code).toBe(0)

      const reports = fake.requests.filter((request) => request.method === "pane.report_metadata")

      expect(reports.length).toBe(2)
      expect(reports[0]?.params.source).toBe(ELAPSED_SOURCE)
      expect(reports[0]?.params.ttl_ms).toBe(ELAPSED_TTL_MS)
      expect(reports[0]?.params.tokens).toEqual({ elapsed: fitWidth("2m") })
      expect(reports[1]?.params.tokens).toEqual({ elapsed: ELAPSED_BLANK })
      expect(JSON.stringify(reports[0]?.params.tokens)).not.toContain("themed_model_tier")
      expect(readFileSync(statePath)).toEqual(before)
    } finally {
      await fake.close()
    }
  })

  test("title publish has no ttl and does not write themed_model_tier", async () => {
    const sandbox = makeSandbox()
    const socketPath = required(sandbox.env, "HERDR_SOCKET_PATH")
    const fake = new FakeHerdr(socketPath)
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.sidebar_installed = true
    state.identities = { w1: { colour: "#7aa2f7", origin: "manual" } }
    save(statePath, state)

    fake.on("agent.list", () => ({
      agents: [{ pane_id: "p1", workspace_id: "w1", tab_id: "t1" }],
    }))
    fake.on("tab.list", () => ({ tabs: [{ tab_id: "t1", label: "Fix auth" }] }))
    fake.on("pane.report_metadata", () => ({}))
    fake.on("workspace.list", () => ({ workspaces: [] }))

    await fake.listen()

    try {
      const result = await run(["reconcile"], sandbox.env)

      expect(result.code).toBe(0)

      const reports = fake.requests.filter((request) => request.method === "pane.report_metadata")
      const title = reports.find((request) => request.params.source === TITLE_SOURCE)
      const clock = reports.find((request) => request.params.source === ELAPSED_SOURCE)

      expect(title?.params.ttl_ms).toBeUndefined()
      expect(title?.params.tokens).toMatchObject({ title_azure: "Fix auth" })
      expect(JSON.stringify(title?.params.tokens)).not.toContain("themed_model_tier")
      expect(clock?.params.ttl_ms).toBe(ELAPSED_TTL_MS)
      expect(JSON.stringify(clock?.params.tokens)).not.toContain("themed_model_tier")
    } finally {
      await fake.close()
    }
  })
})
