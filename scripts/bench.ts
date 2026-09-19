import { createHash } from "node:crypto"
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"

import { Result, Schema } from "effect"

import { PLUGIN_ID } from "../src/ids.ts"
import { readSocketGeneration, workerHeartbeatPath } from "../src/runtime/worker.ts"
import { FakeHerdr } from "../tests/support/fake-herdr.ts"

const repo = join(import.meta.dir, "..")

const pythonCli = join(repo, "src", "main.py")

const tsSource = join(repo, "src", "cli.ts")

const artifact = join(repo, "dist", "mosaic")

const samples = 8

const workerWaitMs = 20_000

const WorkerHeartbeat = Schema.Struct({
  pid: Schema.Number,
  agents: Schema.Number,
  duration_seconds: Schema.Number,
})

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

type ProcCpu = {
  readonly userSeconds: number
  readonly systemSeconds: number
}

type WorkerSample = {
  readonly label: string
  readonly pid: number
  readonly peakRssKb: number
  readonly idleRssKb: number
  readonly cpuUserSeconds: number
  readonly cpuSystemSeconds: number
  readonly roundDurationSeconds: number
  readonly agents: number
  readonly waitMs: number
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

function artifactSha256(): string {
  return createHash("sha256").update(readFileSync(artifact)).digest("hex")
}

function clockTicksPerSecond(): number {
  const result = spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" })
  const value = Number(result.stdout.trim())

  return Number.isFinite(value) && value > 0 ? value : 100
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]

  if (value === undefined || value === "") {
    throw new Error(`missing ${key}`)
  }

  return value
}

function vmRssKb(pid: number): number | undefined {
  try {
    const text = readFileSync(`/proc/${pid}/status`, "utf8")

    for (const line of text.split("\n")) {
      if (!line.startsWith("VmRSS:")) continue

      const kb = Number(line.replace("VmRSS:", "").replace("kB", "").trim())

      if (Number.isFinite(kb)) return kb
    }

    return undefined
  } catch {
    return undefined
  }
}

function cpuSeconds(pid: number, ticksPerSecond: number): ProcCpu | undefined {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8")
    const close = text.lastIndexOf(")")

    if (close < 0) return undefined

    const fields = text.slice(close + 1).trim().split(" ")
    const userTicks = Number(fields[11])
    const systemTicks = Number(fields[12])

    if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks) || ticksPerSecond <= 0) {
      return undefined
    }

    return {
      userSeconds: userTicks / ticksPerSecond,
      systemSeconds: systemTicks / ticksPerSecond,
    }
  } catch {
    return undefined
  }
}

function decodeHeartbeat(raw: string): typeof WorkerHeartbeat.Type {
  const parsed: unknown = JSON.parse(raw)
  const decoded = Schema.decodeUnknownResult(WorkerHeartbeat)(parsed)

  if (Result.isFailure(decoded)) {
    throw new Error(`invalid worker heartbeat: ${raw}`)
  }

  return decoded.success
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
    }, timeoutMs)

    child.once("close", (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return

  child.kill("SIGTERM")
  await waitExit(child, 2_000)
}

function attachPublishHandlers(fake: FakeHerdr): void {
  fake.on("plugin.list", () => ({
    plugins: [{
      plugin_id: PLUGIN_ID,
      enabled: true,
      plugin_root: repo,
    }],
  }))
  fake.on("agent.list", () => ({
    agents: [{ pane_id: "w1:p1", workspace_id: "w1", name: "bench" }],
  }))
  fake.on("tab.list", () => ({ tabs: [] }))
  fake.on("pane.report_metadata", () => ({}))
  fake.on("workspace.list", () => ({ workspaces: [] }))
}

async function sampleWorker(
  label: string,
  execPath: string,
  args: readonly string[],
  ticksPerSecond: number,
): Promise<WorkerSample> {
  const sandbox = isolatedEnv()
  const socketPath = requiredEnv(sandbox.env, "HERDR_SOCKET_PATH")
  const stateDir = requiredEnv(sandbox.env, "HERDR_PLUGIN_STATE_DIR")
  const fake = new FakeHerdr(socketPath)

  attachPublishHandlers(fake)
  await fake.listen()

  writeFileSync(join(stateDir, "state.json"), JSON.stringify({ sidebar_installed: true }))

  const key = readSocketGeneration(socketPath)
  const heartbeatPath = workerHeartbeatPath(stateDir, key)
  const logPath = join(sandbox.cwd, "worker.log")
  const log = openSync(logPath, "w")

  const env: NodeJS.ProcessEnv = {
    ...sandbox.env,
    MOSAIC_TEST_ISOLATED: "",
  }

  const child = spawn(execPath, args.concat(key), {
    cwd: repo,
    env,
    stdio: ["ignore", log, log],
  })

  closeSync(log)

  const pid = child.pid

  if (pid === undefined) {
    await fake.close()
    throw new Error(`${label}: worker did not start`)
  }

  const started = performance.now()
  let peakRss = 0
  let heartbeatRaw: string | undefined

  try {
    while (performance.now() - started < workerWaitMs) {
      const rss = vmRssKb(pid)

      if (rss !== undefined && rss > peakRss) peakRss = rss

      try {
        heartbeatRaw = readFileSync(heartbeatPath, "utf8")
        break
      } catch {
        await sleep(20)
      }
    }

    if (heartbeatRaw === undefined) {
      const logText = readFileSync(logPath, "utf8")

      throw new Error(`${label}: worker heartbeat missing after ${workerWaitMs}ms\n${logText}`)
    }

    const heartbeat = decodeHeartbeat(heartbeatRaw)
    const idleRss = vmRssKb(pid) ?? peakRss
    const cpu = cpuSeconds(pid, ticksPerSecond)

    if (cpu === undefined) {
      throw new Error(`${label}: could not read /proc/${pid}/stat`)
    }

    return {
      label,
      pid,
      peakRssKb: Math.max(peakRss, idleRss),
      idleRssKb: idleRss,
      cpuUserSeconds: cpu.userSeconds,
      cpuSystemSeconds: cpu.systemSeconds,
      roundDurationSeconds: heartbeat.duration_seconds,
      agents: heartbeat.agents,
      waitMs: Math.round(performance.now() - started),
    }
  } finally {
    await stopWorker(child)
    await fake.close()
  }
}

async function main(): Promise<void> {
  ensureArtifact()

  const helpEnv = isolatedEnv()
  const eventPayload = JSON.stringify({ type: "pane_agent_status_changed" })
  const ticksPerSecond = clockTicksPerSecond()

  const pythonWorker = await sampleWorker(
    "python refresh-worker",
    "/usr/bin/python3",
    [pythonCli, "refresh-worker"],
    ticksPerSecond,
  )

  const tsWorker = await sampleWorker(
    "dist/mosaic refresh-worker",
    artifact,
    ["refresh-worker"],
    ticksPerSecond,
  )

  const results = {
    host: `${process.platform} ${process.arch}`,
    bun: process.versions.bun,
    samples,
    ticksPerSecond,
    conditions: {
      isolatedHome: true,
      path: "/usr/bin:/bin",
      worker: "one FakeHerdr pane; sample after first heartbeat; SIGTERM; no MOSAIC_TEST_ISOLATED",
    },
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
    pythonWorker,
    tsWorker,
    package: {
      pythonSrcBytes: pythonBytes(),
      mosaicBytes: statSync(artifact).size,
      mosaicSha256: artifactSha256(),
    },
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
}

await main()
