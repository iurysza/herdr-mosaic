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

describe("set-identity CLI", () => {
  test("opens the picker popup with SPACE_IDENTITY_TARGET", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("plugin.pane.open", () => ({}))
    await fake.listen()

    try {
      const result = await run(["set-identity"], {
        ...sandbox.env,
        HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_id: "w1" }),
      })

      expect(result.code).toBe(0)

      const opened = fake.requests.find((request) => request.method === "plugin.pane.open")

      expect(opened?.params.plugin_id).toBe(PLUGIN_ID)
      expect(opened?.params.entrypoint).toBe("picker")
      expect(opened?.params.focus).toBe(true)
      expect(opened?.params.placement).toBe("popup")
      expect(opened?.params.env).toEqual({ SPACE_IDENTITY_TARGET: "w1" })
    } finally {
      await fake.close()
    }
  })

  test("pick-color is the set-identity alias", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("plugin.pane.open", () => ({}))
    await fake.listen()

    try {
      const result = await run(["pick-color"], {
        ...sandbox.env,
        HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ workspace_id: "w1" }),
      })

      expect(result.code).toBe(0)
      expect(fake.requests.some((request) =>
        request.method === "plugin.pane.open" && request.params.entrypoint === "picker"
      )).toBe(true)
    } finally {
      await fake.close()
    }
  })
})

describe("picker CLI", () => {
  test("needs a terminal when a workspace is known", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("workspace.list", () => ({
      workspaces: [{ workspace_id: "w1", label: "agents", focused: true }],
    }))
    await fake.listen()

    try {
      const result = await run(["picker"], {
        ...sandbox.env,
        SPACE_IDENTITY_TARGET: "w1",
      })

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("picker needs a terminal; run it as the plugin popup, or use:")
      expect(result.stderr).toContain(`dist/mosaic set-color --workspace w1 --color azure`)
    } finally {
      await fake.close()
    }
  })

  test("without a workspace exits 1", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("workspace.list", () => ({ workspaces: [] }))
    await fake.listen()

    try {
      const result = await run(["picker"], sandbox.env)

      expect(result.code).toBe(1)
      expect(result.stderr).toBe("no workspace to edit\n")
    } finally {
      await fake.close()
    }
  })
})
