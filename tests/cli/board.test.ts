import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { PLUGIN_ID } from "../../src/ids.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
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

describe("board CLI", () => {
  test("--once dumps grouped agents without a TTY", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("workspace.list", () => ({
      workspaces: [
        { workspace_id: "w1", number: 1, label: "Web" },
        { workspace_id: "w2", number: 2, label: "API" },
      ],
    }))
    fake.on("agent.list", () => ({
      agents: [
        {
          pane_id: "w1:p1",
          workspace_id: "w1",
          agent_status: "done",
          agent: "codex",
        },
        {
          pane_id: "w2:p1",
          workspace_id: "w2",
          agent_status: "working",
          agent: "pi",
        },
      ],
    }))
    await fake.listen()

    try {
      const result = await run(["board", "--once"], sandbox.env)

      expect(result.code).toBe(0)
      expect(result.stdout).toContain("• Web  (1 done)")
      expect(result.stdout).toContain("codex      done")
      expect(result.stdout).toContain("• API  (1 working)")
      expect(result.stdout).toContain("pi         working")
    } finally {
      await fake.close()
    }
  })

  test("without a TTY, the live board asks for --once", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("workspace.list", () => ({ workspaces: [] }))
    fake.on("agent.list", () => ({ agents: [] }))
    await fake.listen()

    try {
      const result = await run(["board"], sandbox.env)

      expect(result.code).toBe(1)
      expect(result.stderr).toBe("board could not start (not a tty); try --once\n")
    } finally {
      await fake.close()
    }
  })
})

describe("board-open CLI", () => {
  test("opens the board pane", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("plugin.pane.open", () => ({}))
    await fake.listen()

    try {
      const result = await run(["agent-board"], sandbox.env)

      expect(result.code).toBe(0)

      const opened = fake.requests.find((request) => request.method === "plugin.pane.open")

      expect(opened?.params.plugin_id).toBe(PLUGIN_ID)
      expect(opened?.params.entrypoint).toBe("board")
      expect(opened?.params.focus).toBe(true)
    } finally {
      await fake.close()
    }
  })
})
