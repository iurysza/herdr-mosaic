import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLUGIN_ID } from "../../src/ids.ts"
import { UTF8_LOCALE } from "./locale.ts"

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
      HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR: join(root, "wm-state"),
      HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR: join(root, "wm-config"),
      HERDR_LEGACY_CHROMATIC_STATE_DIR: join(root, "chromatic-state"),
      HERDR_LEGACY_CHROMATIC_CONFIG_DIR: join(root, "chromatic-config"),
      HERDR_LEGACY_LAYOUTS_STATE_DIR: join(root, "layouts-state"),
      HERDR_LEGACY_LAYOUTS_CONFIG_DIR: join(root, "layouts-config"),
      MOSAIC_TEST_ISOLATED: "1",
      PATH: "/usr/bin:/bin",
      LANG: UTF8_LOCALE,
      LC_ALL: UTF8_LOCALE,
    },
  }
}

function shSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function installFakeHerdr(sandbox: Sandbox): string {
  const binDir = join(sandbox.root, "bin")

  mkdirSync(binDir, { recursive: true })

  const wrapperPath = join(binDir, "herdr")
  const scriptPath = join(import.meta.dir, "fake-herdr-bin.ts")

  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${shSingleQuote(process.execPath)} ${shSingleQuote(scriptPath)} "$@"\n`,
  )
  chmodSync(wrapperPath, 0o755)

  return wrapperPath
}
