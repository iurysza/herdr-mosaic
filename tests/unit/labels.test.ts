import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { LabelRulesError } from "../../src/runtime/errors.ts"
import { pathsFromEnv } from "../../src/runtime/paths.ts"
import { applyLabelRules, loadRules, parseLabelFile } from "../../src/spaces/labels.ts"
import { defaultState, identityOf, setIdentity } from "../../src/state/store.ts"
import { makeSandbox } from "../support/sandbox.ts"

describe("label rules", () => {
  test("matching label assigns colour", () => {
    const st = defaultState()

    const ids = applyLabelRules(
      st,
      [{ workspace_id: "w9", label: "agents" }],
      [["agents", "#a6d189"]],
    )

    expect(ids).toEqual(["w9"])
    expect(identityOf(st, "w9")).toEqual({ colour: "#a6d189", origin: "label" })
  })

  test("manual origin is not overwritten", () => {
    const st = defaultState()

    setIdentity(st, "w9", "#fab387", "manual")
    expect(applyLabelRules(st, [{ workspace_id: "w9", label: "agents" }], [["agents", "#a6d189"]])).toEqual([])
    expect(identityOf(st, "w9")?.colour).toBe("#fab387")
  })

  test("invalid rules fail clearly", () => {
    expect(() => parseLabelFile({ version: 2, identities: {} }, "rules.json")).toThrow(LabelRulesError)
  })

  test("file rules resolve palette names and overlay settings", () => {
    const sandbox = makeSandbox()
    const path = join(sandbox.root, "rules.json")

    writeFileSync(path, JSON.stringify({ version: 1, identities: { agents: "sage" } }))
    mkdirSync(sandbox.env.HERDR_PLUGIN_CONFIG_DIR ?? sandbox.root, { recursive: true })
    writeFileSync(
      join(sandbox.env.HERDR_PLUGIN_CONFIG_DIR ?? sandbox.root, "settings.json"),
      JSON.stringify({ label_identities: { api: "peach" } }),
    )

    const paths = pathsFromEnv({
      HOME: sandbox.home,
      HERDR_PLUGIN_CONFIG_DIR: sandbox.env.HERDR_PLUGIN_CONFIG_DIR,
      HERDR_CONFIG_PATH: sandbox.env.HERDR_CONFIG_PATH,
    })

    const rules = loadRules(paths, undefined, path)
    const st = defaultState()

    const changed = applyLabelRules(st, [
      { workspace_id: "w1", label: "agents" },
      { workspace_id: "w2", label: "api" },
    ], rules)

    expect(changed).toEqual(["w1", "w2"])
    expect(identityOf(st, "w1")).toEqual({ colour: "#a6d189", origin: "label" })
    expect(identityOf(st, "w2")).toEqual({ colour: "#fab387", origin: "label" })
  })
})
