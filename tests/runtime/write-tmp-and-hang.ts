#!/usr/bin/env bun
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs"
import { basename, dirname, join } from "node:path"

const path = process.argv[2]

if (path === undefined || path === "") {
  process.stderr.write("write-tmp-and-hang requires a path\n")
  process.exit(2)
}

const text = process.argv[3] ?? "{partial"

const directory = dirname(path) || "."

mkdirSync(directory, { recursive: true })

const tmp = join(directory, `.${basename(path)}.tmp.${process.pid}`)

const fd = openSync(tmp, "w")

writeSync(fd, text)

fsyncSync(fd)

closeSync(fd)

process.stdout.write(`tmp:${tmp}\n`)

await Bun.sleep(60_000)
