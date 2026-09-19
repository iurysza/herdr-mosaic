import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { PLUGIN_ID } from "../../src/ids.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { load } from "../../src/state/store.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

const WORKSPACES = [
  { workspace_id: "w1", number: 1, label: "agents", focused: true },
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

function identityEnv() {
  const sandbox = makeSandbox()
  const socketPath = sandbox.env.HERDR_SOCKET_PATH

  if (socketPath === undefined) throw new Error("missing socket path")

  const fake = new FakeHerdr(socketPath)

  fake.on("workspace.list", () => ({ workspaces: WORKSPACES }))
  fake.on("agent.list", () => ({ agents: [] }))
  fake.on("workspace.report_metadata", () => ({}))
  fake.on("pane.report_metadata", () => ({}))
  fake.on("tab.list", () => ({ tabs: [] }))

  return { sandbox, fake, env: sandbox.env, socketPath }
}

describe("apply-identity CLI", () => {
  test("saves a palette colour and publishes workspace metadata", async () => {
    const { fake, env } = identityEnv()

    await fake.listen()

    try {
      const result = await run(["apply-identity", "--workspace", "w1", "--colour", "azure"], env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("w1 ->")
      expect(result.stdout).toContain("#7aa2f7")

      const state = load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json"))

      expect(state.identities.w1).toEqual({ colour: "#7aa2f7", origin: "manual" })

      const published = fake.requests.filter((request) => request.method === "workspace.report_metadata")

      expect(published.length).toBe(1)
      expect(published[0]?.params.source).toBe(PLUGIN_ID)
      expect(published[0]?.params.workspace_id).toBe("w1")
    } finally {
      await fake.close()
    }
  })

  test("set-color --color matches apply-identity --colour", async () => {
    const { fake, env } = identityEnv()

    await fake.listen()

    try {
      const result = await run(["set-color", "--workspace", "w1", "--color", "#ABC"], env)

      expect(result.code).toBe(0)

      const state = load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json"))

      expect(state.identities.w1).toEqual({ colour: "#aabbcc", origin: "manual" })
      expect(result.stdout).toContain("nearest palette slot")
    } finally {
      await fake.close()
    }
  })

  test("invalid colour does not save or call herdr", async () => {
    const { fake, env } = identityEnv()

    await fake.listen()

    try {
      const result = await run(["set-color", "--workspace", "w1", "--color", "invalid"], env)

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("is not a palette name")
      expect(load(join(env.HERDR_PLUGIN_STATE_DIR ?? "", "state.json")).identities).toEqual({})
      expect(fake.requests).toEqual([])
    } finally {
      await fake.close()
    }
  })
})
