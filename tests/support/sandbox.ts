import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLUGIN_ID } from "../../src/ids.ts"

export type Sandbox = {
  readonly root: string
  readonly home: string
  readonly env: { [key: string]: string }
}

export function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "mosaic-sandbox-"))
  const home = join(root, "home")
  const config = join(home, ".config", "herdr")
  const state = join(home, ".local", "state", "herdr", "plugins", PLUGIN_ID)
  const pluginConfig = join(config, "plugins", "config", PLUGIN_ID)
  mkdirSync(config, { recursive: true })
  mkdirSync(state, { recursive: true })
  mkdirSync(pluginConfig, { recursive: true })

  return {
    root,
    home,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      TMPDIR: root,
      HERDR_CONFIG_PATH: join(config, "config.toml"),
      HERDR_SOCKET_PATH: join(config, "herdr.sock"),
      HERDR_BIN_PATH: join(root, "bin", "missing-herdr"),
      HERDR_PLUGIN_ROOT: join(import.meta.dir, "..", ".."),
      HERDR_PLUGIN_ID: PLUGIN_ID,
      HERDR_PLUGIN_STATE_DIR: state,
      HERDR_PLUGIN_CONFIG_DIR: pluginConfig,
      MOSAIC_TEST_ISOLATED: "1",
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
    },
  }
}
