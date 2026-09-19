import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
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

describe("prune CLI", () => {
  test("extra argv prints usage", async () => {
    const sandbox = makeSandbox()
    const result = await run(["prune", "extra"], sandbox.env)

    expect(result.code).toBe(1)
    expect(result.stderr).toBe("usage: prune\n")
  })

  test("needs a terminal", async () => {
    const sandbox = makeSandbox()
    const result = await run(["prune"], sandbox.env)

    expect(result.code).toBe(1)
    expect(result.stderr).toBe("prune needs a terminal; run it through the Mosaic action.\n")
  })
})
