#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const logPath = process.env.MOSAIC_FAKE_HERDR_LOG

if (logPath !== undefined && logPath !== "") {
  mkdirSync(dirname(logPath), { recursive: true })
  writeFileSync(logPath, `${JSON.stringify(process.argv.slice(2))}\n`, { flag: "a" })
}

if (process.argv.includes("--version")) {
  process.stdout.write("herdr 0.0-fake\n")
  process.exit(0)
}

if (process.argv.includes("config") && process.argv.includes("check")) {
  checkConfig()
}

process.stderr.write("fake herdr: unexpected invocation\n")

process.exit(2)

function checkConfig(): never {
  const configPath = process.env.HERDR_CONFIG_PATH

  if (configPath === undefined || configPath === "") {
    process.stdout.write("config parse error\n")
    process.exit(1)
  }

  let text: string

  try {
    text = readFileSync(configPath, "utf8")
  } catch {
    process.stdout.write("config parse error\n")
    process.exit(1)
  }

  if (text.includes("not_a_real_token")) {
    process.stdout.write("unknown token not_a_real_token\n")
    process.exit(1)
  }

  if (text.includes("legacy_unknown_key")) {
    process.stdout.write("unknown key legacy_unknown_key\n")
    process.exit(1)
  }

  if (looksLikeBrokenToml(text)) {
    process.stdout.write("config parse error\n")
    process.exit(1)
  }

  process.stdout.write("ok\n")
  process.exit(0)
}

function looksLikeBrokenToml(text: string): boolean {
  if (text.includes("config parse error")) return true

  const open = text.lastIndexOf("[")

  if (open === -1) return false

  return text.indexOf("]", open) === -1
}
