import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { load, save, defaultState } from "../../src/state/store.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

const WORKSPACES = [
  { workspace_id: "w1", number: 1, label: "agents", focused: true },
  { workspace_id: "w2", number: 2, label: "ops", focused: false },
]

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

function assignEnv() {
  const sandbox = makeSandbox()
  const socketPath = sandbox.env.HERDR_SOCKET_PATH

  if (socketPath === undefined) throw new Error("missing socket path")

  const fake = new FakeHerdr(socketPath)

  fake.on("workspace.list", () => ({ workspaces: WORKSPACES }))
  fake.on("agent.list", () => ({ agents: [] }))
  fake.on("workspace.report_metadata", () => ({}))
  fake.on("pane.report_metadata", () => ({}))

  return { sandbox, fake, env: sandbox.env }
}

describe("auto-assign CLI", () => {
  test("assigns missing identities and is idempotent", async () => {
    const { fake, env } = assignEnv()

    await fake.listen()

    try {
      const first = await run(["auto-assign"], env)

      expect(first.code).toBe(0)
      expect(first.stdout).toContain("assigned: w1, w2")

      const state = load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json"))

      expect(state.identities.w1).toMatchObject({ origin: "auto" })
      expect(state.identities.w2).toMatchObject({ origin: "auto" })

      const second = await run(["assign-colors"], env)

      expect(second.code).toBe(0)
      expect(second.stdout).toContain("assigned: (all spaces already had identities)")
      expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).identities).toEqual(state.identities)
    } finally {
      await fake.close()
    }
  })

  test("--force reassigns only the focused workspace", async () => {
    const { fake, env } = assignEnv()

    await fake.listen()

    try {
      const st = defaultState()

      st.identities.w1 = { colour: "#fab387", origin: "manual" }
      st.identities.w2 = { colour: "#a6d189", origin: "manual" }
      save(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json"), st)

      const result = await run(["auto-assign", "--force"], env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("assigned: w1")

      const next = load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json"))

      expect(next.identities.w1).toMatchObject({ origin: "auto" })
      expect(next.identities.w2).toEqual({ colour: "#a6d189", origin: "manual" })
    } finally {
      await fake.close()
    }
  })
})
