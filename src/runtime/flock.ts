import { platform } from "node:os"

import { dlopen, FFIType, read, suffix } from "bun:ffi"

const LOCK_EX = 2

const LOCK_NB = 4

const LOCK_UN = 8

const EAGAIN_LINUX = 11

const EAGAIN_DARWIN = 35

const EACCES = 13

type FlockLib = {
  flock(fd: number, operation: number): number
  errno(): number
}

function darwinLib(): FlockLib {
  const lib = dlopen("libSystem.B.dylib", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    __error: { args: [], returns: FFIType.ptr },
  })

  return {
    flock: (fd, operation) => lib.symbols.flock(fd, operation),
    errno: () => {
      const location = lib.symbols.__error()

      return location === null || location === 0 ? -1 : read.i32(location, 0)
    },
  }
}

function linuxLib(): FlockLib {
  const lib = dlopen(`libc.${suffix}`, {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  })

  return {
    flock: (fd, operation) => lib.symbols.flock(fd, operation),
    errno: () => {
      const location = lib.symbols.__errno_location()

      return location === null || location === 0 ? -1 : read.i32(location, 0)
    },
  }
}

const lib = platform() === "darwin" ? darwinLib() : linuxLib()

const wouldBlock = new Set([
  EACCES,
  platform() === "darwin" ? EAGAIN_DARWIN : EAGAIN_LINUX,
])

export function tryExclusive(fd: number): "acquired" | "busy" | "failed" {
  const result = lib.flock(fd, LOCK_EX | LOCK_NB)

  if (result === 0) return "acquired"
  const code = lib.errno()

  if (wouldBlock.has(code) || code === -1) return "busy"

  return "failed"
}

export function unlock(fd: number): void {
  lib.flock(fd, LOCK_UN)
}

export function errnoCode(): number {
  return lib.errno()
}
