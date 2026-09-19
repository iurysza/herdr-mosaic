import { readFileSync } from "node:fs"

import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"

import { commitDoc, loadDoc } from "../../src/config/patch.ts"
import { TomlDoc } from "../../src/config/toml-edit.ts"
import { ConfigError } from "../../src/runtime/errors.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { installFakeHerdr, makeSandbox } from "../support/sandbox.ts"

const USERS_REAL = `onboarding = false

[theme]
name = "gruvbox"

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"]]
`

async function provide<A, E>(
  env: ReturnType<typeof makeSandbox>["env"],
  effect: Effect.Effect<A, E, PluginPaths>,
) {
  const previous = { ...process.env }

  Object.assign(process.env, env)

  try {
    return await Effect.runPromise(effect.pipe(Effect.provide(PluginPaths.layer)))
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key]
    }

    Object.assign(process.env, previous)
  }
}

describe("config validation", () => {
  test("commit refuses an invalid token and leaves live bytes unchanged", async () => {
    const sandbox = makeSandbox()
    const herdr = installFakeHerdr(sandbox)

    sandbox.env.HERDR_BIN_PATH = herdr
    const path = sandbox.env.HERDR_CONFIG_PATH

    if (path === undefined) throw new Error("missing config path")

    await Bun.write(path, USERS_REAL)
    const doc = loadDoc(path)

    doc.set(["ui", "sidebar", "spaces", "rows"], [["not_a_real_token"]])

    const result = await provide(
      sandbox.env,
      commitDoc(doc, path).pipe(Effect.result),
    )

    expect(Result.isFailure(result)).toBe(true)

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ConfigError)
    }

    expect(readFileSync(path, "utf8")).toBe(USERS_REAL)
  })

  test("commit allows a pre-existing unknown key warning", async () => {
    const sandbox = makeSandbox()
    const herdr = installFakeHerdr(sandbox)

    sandbox.env.HERDR_BIN_PATH = herdr
    const path = sandbox.env.HERDR_CONFIG_PATH

    if (path === undefined) throw new Error("missing config path")

    const baseline = '[theme]\nname = "gruvbox"\nlegacy_unknown_key = 1\n'

    await Bun.write(path, baseline)
    const doc = new TomlDoc(baseline)

    doc.set(["ui", "sidebar", "spaces", "rows"], [["state_icon", "workspace"]])

    await provide(sandbox.env, commitDoc(doc, path))
    expect(readFileSync(path, "utf8")).toContain("legacy_unknown_key = 1")
    expect(readFileSync(path, "utf8")).toContain("state_icon")
  })
})
