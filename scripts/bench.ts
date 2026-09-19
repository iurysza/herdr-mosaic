import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { PLUGIN_ID } from "../src/ids.ts"

const repo = join(import.meta.dir, "..")

const pythonCli = join(repo, "src", "main.py")

const tsSource = join(repo, "src", "cli.ts")

const artifact = join(repo, "dist", "mosaic")

const samples = 8

type TimedRun = {
  readonly label: string
  readonly millis: readonly number[]
  readonly medianMs: number
  readonly exit: number
}

type BenchSandbox = {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  const value = sorted[mid]

  return value ?? 0
}

function timeCommand(label: string, argv: readonly string[], env: NodeJS.ProcessEnv, cwd: string): TimedRun {
  const millis: number[] = []
  let exit = 0

  for (let index = 0; index < samples; index += 1) {
    const started = performance.now()

    const result = spawnSync(argv[0] ?? "", argv.slice(1), {
      cwd,
      env,
      encoding: "utf8",
    })

    millis.push(performance.now() - started)
    exit = result.status ?? 1
  }

  return { label, millis, medianMs: median(millis), exit }
}

function ensureArtifact(): void {
  if (statSync(artifact, { throwIfNoEntry: false })?.isFile()) return

  const built = spawnSync(
    process.execPath,
    [
      "build",
      tsSource,
      "--compile",
      "--outfile",
      artifact,
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
    ],
    { cwd: repo, encoding: "utf8" },
  )

  if (built.status !== 0) {
    process.stderr.write(built.stderr)
    process.exit(1)
  }
}

function isolatedEnv(): BenchSandbox {
  const root = mkdtempSync(join(tmpdir(), "mosaic-bench-"))
  const home = join(root, "home")
  const config = join(home, ".config", "herdr")
  const state = join(home, ".local", "state", "herdr", "plugins", PLUGIN_ID)

  mkdirSync(config, { recursive: true })
  mkdirSync(state, { recursive: true })
  writeFileSync(join(config, "config.toml"), "[theme]\nname = \"gruvbox\"\n")

  return {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      TMPDIR: root,
      HERDR_PLUGIN_ID: PLUGIN_ID,
      HERDR_PLUGIN_ROOT: repo,
      HERDR_PLUGIN_STATE_DIR: state,
      HERDR_PLUGIN_CONFIG_DIR: join(config, "plugins", "config", PLUGIN_ID),
      HERDR_CONFIG_PATH: join(config, "config.toml"),
      HERDR_SOCKET_PATH: join(config, "herdr.sock"),
      HERDR_BIN_PATH: join(root, "missing-herdr"),
      MOSAIC_TEST_ISOLATED: "1",
      PATH: "/usr/bin:/bin",
    },
  }
}

function pythonBytes(): number {
  const listing = spawnSync("bash", ["-lc", `stat -c %s ${repo}/src/*.py | awk '{s+=$1} END {print s}'`], {
    encoding: "utf8",
  })

  return Number(listing.stdout.trim())
}

ensureArtifact()

const helpEnv = isolatedEnv()

const eventPayload = JSON.stringify({ type: "pane_agent_status_changed" })

const results = {
  host: `${process.platform} ${process.arch}`,
  bun: process.versions.bun,
  samples,
  pythonHelp: timeCommand(
    "python --help",
    ["/usr/bin/python3", pythonCli, "--help"],
    helpEnv.env,
    helpEnv.cwd,
  ),
  tsSourceHelp: timeCommand(
    "bun source --help",
    [process.execPath, "--no-env-file", tsSource, "--help"],
    { ...helpEnv.env, PATH: `${process.env.PATH}:/usr/bin:/bin` },
    helpEnv.cwd,
  ),
  tsArtifactHelp: timeCommand(
    "dist/mosaic --help",
    [artifact, "--help"],
    helpEnv.env,
    helpEnv.cwd,
  ),
  pythonEvent: timeCommand(
    "python malformed event",
    ["/usr/bin/python3", pythonCli, "event", "pane.agent_status_changed"],
    { ...helpEnv.env, HERDR_PLUGIN_EVENT: "pane.agent_status_changed", HERDR_PLUGIN_EVENT_JSON: eventPayload },
    helpEnv.cwd,
  ),
  tsEvent: timeCommand(
    "dist/mosaic malformed event",
    [artifact, "event", "pane.agent_status_changed"],
    { ...helpEnv.env, HERDR_PLUGIN_EVENT: "pane.agent_status_changed", HERDR_PLUGIN_EVENT_JSON: eventPayload },
    helpEnv.cwd,
  ),
  package: {
    pythonSrcBytes: pythonBytes(),
    mosaicBytes: statSync(artifact).size,
  },
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
