#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs"
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
  process.stdout.write("ok\n")
  process.exit(0)
}

process.stderr.write("fake herdr: unexpected invocation\n")

process.exit(2)
