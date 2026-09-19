import { existsSync } from "node:fs"
import { join } from "node:path"

import type { PluginPathValues } from "../runtime/paths.ts"
import { isFile } from "./files.ts"

export function windowManagerPending(paths: PluginPathValues): boolean {
  return isFile(join(paths.windowManagerStateDir, "state.json"))
    && !existsSync(join(paths.stateDir, "state.json"))
}
