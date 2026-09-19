import { copyFileSync, mkdirSync, statSync } from "node:fs"
import { dirname } from "node:path"

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function copyExact(source: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(source, dest)
}
