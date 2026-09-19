import { describe, expect, test } from "bun:test"

import {
  CLI_ALIASES,
  helpText,
  processCliArgv,
  rewriteArgv,
  wantsHelp,
} from "../../src/dispatch/catalog.ts"

function isAlias(name: string): name is keyof typeof CLI_ALIASES {
  return Object.hasOwn(CLI_ALIASES, name)
}

describe("CLI catalog", () => {
  test("rewriteArgv expands every alias and keeps extra argv", () => {
    for (const name of Object.keys(CLI_ALIASES)) {
      if (!isAlias(name)) continue

      expect(rewriteArgv([name, "--example", "value"])).toEqual([
        ...CLI_ALIASES[name],
        "--example",
        "value",
      ])
    }
  })

  test("rewriteArgv leaves ordinary commands unchanged", () => {
    expect(rewriteArgv(["doctor", "--force"])).toEqual(["doctor", "--force"])
    expect(rewriteArgv([])).toEqual([])
  })

  test("processCliArgv drops bun compiled placeholders", () => {
    expect(processCliArgv(["bun", "/$bunfs/root/mosaic", "doctor"])).toEqual(["doctor"])
    expect(processCliArgv(["bun", "src/cli.ts", "doctor"])).toEqual(["doctor"])
    expect(processCliArgv(["dist/mosaic", "doctor"])).toEqual(["doctor"])
  })

  test("helpText lists aliases in sorted order", () => {
    const text = helpText()
    const aliases = Object.keys(CLI_ALIASES).sort()
    let last = -1

    for (const alias of aliases) {
      const index = text.indexOf(`  ${alias} -> `)

      expect(index).toBeGreaterThan(last)
      last = index
    }
  })

  test("wantsHelp treats empty argv and flags", () => {
    expect(wantsHelp([])).toBe(true)
    expect(wantsHelp(["-h"])).toBe(true)
    expect(wantsHelp(["doctor", "--help"])).toBe(true)
    expect(wantsHelp(["doctor"])).toBe(false)
  })
})
