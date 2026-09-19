import { closeSync, openSync } from "node:fs"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLUGIN_ID } from "../../src/ids.ts"
import { resolveHostHerdrBin } from "./host-herdr.ts"

export function herdrBin(): string {
  const fromEnv = resolveHostHerdrBin({
    MOSAIC_HERDR_BIN: process.env.MOSAIC_HERDR_BIN,
    HERDR_BIN_PATH: process.env.HERDR_BIN_PATH,
  })

  if (fromEnv !== undefined) return fromEnv

  throw new Error("Herdr is required for tests/herdr; set MOSAIC_HERDR_BIN or HERDR_BIN_PATH")
}

export type IsolatedHerdr = {
  readonly home: string
  readonly bin: string
  readonly env: NodeJS.ProcessEnv
  readonly socketPath: string
  readonly configPath: string
  readonly stateDir: string
  readonly pid: number
  stop(): Promise<void>
}

export function startIsolatedHerdr(bin: string): IsolatedHerdr {
  const home = mkdtempSync(join(tmpdir(), "mosaic-proof-"))
  const config = join(home, ".config", "herdr")
  const stateDir = join(home, ".local", "state", "herdr", "plugins", PLUGIN_ID)
  const socketPath = join(config, "herdr.sock")
  const configPath = join(config, "config.toml")
  mkdirSync(config, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  mkdirSync(join(home, ".cache"), { recursive: true })
  writeFileSync(configPath, '[theme]\nname = "gruvbox"\n')

  const env: NodeJS.ProcessEnv = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    HERDR_CONFIG_PATH: configPath,
    HERDR_SOCKET_PATH: socketPath,
    HERDR_BIN_PATH: bin,
    HERDR_PLUGIN_ROOT: join(import.meta.dir, "..", ".."),
    HERDR_PLUGIN_ID: PLUGIN_ID,
    HERDR_PLUGIN_STATE_DIR: stateDir,
    HERDR_PLUGIN_CONFIG_DIR: join(config, "plugins", "config", PLUGIN_ID),
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/sh",
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TMPDIR: home,
  }

  const log = openSync(join(home, "server.log"), "w")

  const child = spawn(bin, ["server"], {
    cwd: home,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  })

  closeSync(log)
  child.unref()

  const pid = child.pid

  if (pid === undefined) throw new Error("herdr server did not start")

  return {
    home,
    bin,
    env,
    socketPath,
    configPath,
    stateDir,
    pid,
    async stop() {
      try {
        process.kill(-pid, "SIGTERM")
      } catch {
        try {
          process.kill(pid, "SIGTERM")
        } catch {
          // already gone
        }
      }

      await Bun.sleep(50)

      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        // already gone
      }
    },
  }
}
