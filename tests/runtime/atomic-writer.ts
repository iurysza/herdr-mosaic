#!/usr/bin/env bun
import { atomicWrite } from "../../src/runtime/lock.ts"

const path = process.argv[2]

const text = process.argv[3]

if (path === undefined || text === undefined) {
  process.stderr.write("atomic-writer requires a path and payload\n")
  process.exit(2)
}

atomicWrite(path, text)

process.stdout.write("ok\n")
