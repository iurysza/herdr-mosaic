import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Context, Layer, Schema } from "effect"

import { CHROMATIC_ID, LAYOUTS_ID, PLUGIN_ID, WINDOW_MANAGER_ID } from "../ids.ts"

const optionalPath = Schema.optionalKey(Schema.NonEmptyString)

export const ProcessEnv = Schema.Struct({
  HOME: optionalPath,
  HERDR_PLUGIN_ID: optionalPath,
  HERDR_PLUGIN_ROOT: optionalPath,
  HERDR_PLUGIN_STATE_DIR: optionalPath,
  HERDR_PLUGIN_CONFIG_DIR: optionalPath,
  HERDR_CONFIG_PATH: optionalPath,
  HERDR_SOCKET_PATH: optionalPath,
  HERDR_BIN_PATH: optionalPath,
  HERDR_PLUGIN_EVENT: optionalPath,
  HERDR_PLUGIN_EVENT_JSON: optionalPath,
  HERDR_PLUGIN_CONTEXT_JSON: optionalPath,
  HERDR_PANE_ID: optionalPath,
  HERDR_TAB_ID: optionalPath,
  HERDR_WORKSPACE_ID: optionalPath,
  HERDR_PLUGIN_ENTRYPOINT_ID: optionalPath,
  HERDR_PLUGIN_ACTION_ID: optionalPath,
  HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR: optionalPath,
  HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR: optionalPath,
  HERDR_LEGACY_CHROMATIC_STATE_DIR: optionalPath,
  HERDR_LEGACY_CHROMATIC_CONFIG_DIR: optionalPath,
  HERDR_LEGACY_LAYOUTS_STATE_DIR: optionalPath,
  HERDR_LEGACY_LAYOUTS_CONFIG_DIR: optionalPath,
  SPACE_IDENTITY_TARGET: optionalPath,
  MOSAIC_PRUNE_PROTECTED_PANE: optionalPath,
  MOSAIC_PANE_MOVE_SOURCE: optionalPath,
  MOSAIC_PANE_MOVE_DESTINATION: optionalPath,
})

export type ProcessEnvValues = typeof ProcessEnv.Type

const ENV_KEYS = [
  "HOME",
  "HERDR_PLUGIN_ID",
  "HERDR_PLUGIN_ROOT",
  "HERDR_PLUGIN_STATE_DIR",
  "HERDR_PLUGIN_CONFIG_DIR",
  "HERDR_CONFIG_PATH",
  "HERDR_SOCKET_PATH",
  "HERDR_BIN_PATH",
  "HERDR_PLUGIN_EVENT",
  "HERDR_PLUGIN_EVENT_JSON",
  "HERDR_PLUGIN_CONTEXT_JSON",
  "HERDR_PANE_ID",
  "HERDR_TAB_ID",
  "HERDR_WORKSPACE_ID",
  "HERDR_PLUGIN_ENTRYPOINT_ID",
  "HERDR_PLUGIN_ACTION_ID",
  "HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR",
  "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR",
  "HERDR_LEGACY_CHROMATIC_STATE_DIR",
  "HERDR_LEGACY_CHROMATIC_CONFIG_DIR",
  "HERDR_LEGACY_LAYOUTS_STATE_DIR",
  "HERDR_LEGACY_LAYOUTS_CONFIG_DIR",
  "SPACE_IDENTITY_TARGET",
  "MOSAIC_PRUNE_PROTECTED_PANE",
  "MOSAIC_PANE_MOVE_SOURCE",
  "MOSAIC_PANE_MOVE_DESTINATION",
] as const

export function readProcessEnv(): ProcessEnvValues {
  const raw: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}

  for (const key of ENV_KEYS) {
    const value = process.env[key]

    if (value) raw[key] = value
  }

  return Schema.decodeUnknownSync(ProcessEnv)(raw)
}

function defaultPluginRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..")
}

export function pathsFromEnv(env: ProcessEnvValues) {
  const home = env.HOME ?? homedir()

  const stateDir = env.HERDR_PLUGIN_STATE_DIR
    ?? join(home, ".local", "state", "herdr", "plugins", PLUGIN_ID)

  const configDir = env.HERDR_PLUGIN_CONFIG_DIR
    ?? join(home, ".config", "herdr", "plugins", "config", PLUGIN_ID)

  return {
    home,
    pluginRoot: env.HERDR_PLUGIN_ROOT ?? defaultPluginRoot(),
    stateDir,
    configDir,
    herdrConfigPath: env.HERDR_CONFIG_PATH ?? join(home, ".config", "herdr", "config.toml"),
    socketPath: env.HERDR_SOCKET_PATH ?? join(home, ".config", "herdr", "herdr.sock"),
    herdrBin: env.HERDR_BIN_PATH ?? join(home, ".local", "bin", "herdr"),
    registeredPluginId: env.HERDR_PLUGIN_ID,
    windowManagerStateDir: env.HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR
      ?? join(dirname(stateDir), WINDOW_MANAGER_ID),
    windowManagerConfigDir: env.HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR
      ?? join(dirname(configDir), WINDOW_MANAGER_ID),
    chromaticStateDir: env.HERDR_LEGACY_CHROMATIC_STATE_DIR
      ?? join(home, ".local", "state", "herdr", "plugins", CHROMATIC_ID),
    chromaticConfigDir: env.HERDR_LEGACY_CHROMATIC_CONFIG_DIR
      ?? join(home, ".config", "herdr", "plugins", "config", CHROMATIC_ID),
    layoutsStateDir: env.HERDR_LEGACY_LAYOUTS_STATE_DIR
      ?? join(home, ".local", "state", "herdr", "plugins", LAYOUTS_ID),
    layoutsConfigDir: env.HERDR_LEGACY_LAYOUTS_CONFIG_DIR
      ?? join(home, ".config", "herdr", "plugins", "config", LAYOUTS_ID),
    paneId: env.HERDR_PANE_ID,
    tabId: env.HERDR_TAB_ID,
    workspaceId: env.HERDR_WORKSPACE_ID,
    eventName: env.HERDR_PLUGIN_EVENT,
    eventJson: env.HERDR_PLUGIN_EVENT_JSON,
    contextJson: env.HERDR_PLUGIN_CONTEXT_JSON,
    entrypointId: env.HERDR_PLUGIN_ENTRYPOINT_ID,
    actionId: env.HERDR_PLUGIN_ACTION_ID,
    spaceIdentityTarget: env.SPACE_IDENTITY_TARGET,
    pruneProtectedPane: env.MOSAIC_PRUNE_PROTECTED_PANE,
    paneMoveSource: env.MOSAIC_PANE_MOVE_SOURCE,
    paneMoveDestination: env.MOSAIC_PANE_MOVE_DESTINATION,
  } as const
}

export type PluginPathValues = ReturnType<typeof pathsFromEnv>

export class PluginPaths extends Context.Service<PluginPaths, PluginPathValues>()(
  "iurysza.mosaic/runtime/PluginPaths",
) {
  static readonly layer = Layer.sync(PluginPaths, () =>
    PluginPaths.of(pathsFromEnv(readProcessEnv()))
  )
}
