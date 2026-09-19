import { existsSync } from "node:fs"
import { join } from "node:path"

export type HostHerdrEnv = {
  readonly MOSAIC_HERDR_BIN?: string
  readonly HERDR_BIN_PATH?: string
  readonly HOME?: string
}

export function isUsableHerdrBin(path: string | undefined): path is string {
  return (
    path !== undefined
    && path.length > 0
    && !path.endsWith("missing-herdr")
    && existsSync(path)
  )
}

export function resolveHostHerdrBin(env: HostHerdrEnv): string | undefined {
  const homeBin =
    env.HOME === undefined || env.HOME.length === 0
      ? undefined
      : join(env.HOME, ".local", "bin", "herdr")

  const candidates = [
    env.MOSAIC_HERDR_BIN,
    env.HERDR_BIN_PATH,
    "/tmp/mosaic-tools/herdr",
    homeBin,
  ]

  for (const candidate of candidates) {
    if (isUsableHerdrBin(candidate)) return candidate
  }

  return undefined
}
