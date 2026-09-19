import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "mosaic-test-"))

const home = join(root, "home")

const config = join(home, ".config", "herdr")

const state = join(home, ".local", "state", "herdr", "plugins", "iurysza.mosaic")

const pluginConfig = join(home, ".config", "herdr", "plugins", "config", "iurysza.mosaic")

mkdirSync(config, { recursive: true })

mkdirSync(state, { recursive: true })

mkdirSync(pluginConfig, { recursive: true })

mkdirSync(join(home, ".cache"), { recursive: true })

writeFileSync(join(config, "config.toml"), "# isolated mosaic test config\n")

const isolated = {
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  TMPDIR: root,
  HERDR_CONFIG_PATH: join(config, "config.toml"),
  HERDR_SOCKET_PATH: join(config, "herdr.sock"),
  HERDR_BIN_PATH: join(root, "bin", "missing-herdr"),
  HERDR_PLUGIN_ROOT: join(import.meta.dir, "..", ".."),
  HERDR_PLUGIN_ID: "iurysza.mosaic",
  HERDR_PLUGIN_STATE_DIR: state,
  HERDR_PLUGIN_CONFIG_DIR: pluginConfig,
  MOSAIC_TEST_ISOLATED: "1",
  MOSAIC_TEST_HOME: home,
  TERM: "dumb",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
}

for (const key of Object.keys(process.env)) {
  if (
    key.startsWith("HERDR_")
    || key === "BUN_CONFIG_FILE"
    || key === "DOTENV_CONFIG_PATH"
  ) {
    delete process.env[key]
  }
}

Object.assign(process.env, isolated)

process.chdir(root)
