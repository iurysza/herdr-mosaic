import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { rpcCall } from "../../src/runtime/rpc.ts"
import { PluginPaths, pathsFromEnv } from "../../src/runtime/paths.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

describe("fake Herdr transport", () => {
  test("matches request ids, ignores unsolicited events, and returns errors", async () => {
    const sandbox = makeSandbox()
    const socketPath = join(sandbox.root, "herdr.sock")
    const fake = new FakeHerdr(socketPath)
    fake.queueUnsolicited({ method: "workspace.focused", params: {} })
    fake.on("ping", () => ({ ok: true }))
    fake.on("workspace.list", () => ({
      error: { code: "denied", message: "nope" },
    }))
    await fake.listen()

    const paths = PluginPaths.of(pathsFromEnv({
      HOME: sandbox.home,
      HERDR_SOCKET_PATH: socketPath,
    }))

    try {
      const ping = await Effect.runPromise(
        rpcCall("ping").pipe(Effect.provideService(PluginPaths, paths)),
      )

      expect(ping).toEqual({ ok: true })
      await expect(
        Effect.runPromise(rpcCall("workspace.list").pipe(Effect.provideService(PluginPaths, paths))),
      ).rejects.toThrow(/nope/)
      expect(fake.unexpected).toEqual([])
    } finally {
      await fake.close()
    }
  })

  test("reassembles a fragmented reply after interleaved events and garbage", async () => {
    const sandbox = makeSandbox()
    const socketPath = join(sandbox.root, "herdr.sock")
    const fake = new FakeHerdr(socketPath)

    fake.fragmentDelayMs = 25
    fake.queueUnsolicited({ method: "workspace.focused", params: {} })
    fake.queueUnsolicited({ id: "other-id", result: { stolen: true } })
    fake.queueRawLine("{not-json")
    fake.queueRawLine("")
    fake.on("ping", () => ({ ok: true, note: "fragmented-reply" }))
    await fake.listen()

    const paths = PluginPaths.of(pathsFromEnv({
      HOME: sandbox.home,
      HERDR_SOCKET_PATH: socketPath,
    }))

    try {
      const ping = await Effect.runPromise(
        rpcCall("ping").pipe(Effect.provideService(PluginPaths, paths)),
      )

      expect(ping).toEqual({ ok: true, note: "fragmented-reply" })
    } finally {
      await fake.close()
    }
  })

  test("a non-object result becomes an empty object", async () => {
    const sandbox = makeSandbox()
    const socketPath = join(sandbox.root, "herdr.sock")
    const fake = new FakeHerdr(socketPath)

    fake.setRawResult("ping", "[1,2,3]")
    await fake.listen()

    const paths = PluginPaths.of(pathsFromEnv({
      HOME: sandbox.home,
      HERDR_SOCKET_PATH: socketPath,
    }))

    try {
      const ping = await Effect.runPromise(
        rpcCall("ping").pipe(Effect.provideService(PluginPaths, paths)),
      )

      expect(ping).toEqual({})
    } finally {
      await fake.close()
    }
  })

  test("records unexpected methods instead of answering them", async () => {
    const sandbox = makeSandbox()
    const socketPath = join(sandbox.root, "herdr.sock")
    const fake = new FakeHerdr(socketPath)
    await fake.listen()

    const paths = PluginPaths.of(pathsFromEnv({
      HOME: sandbox.home,
      HERDR_SOCKET_PATH: socketPath,
    }))

    try {
      await expect(
        Effect.runPromise(rpcCall("nope", {}, 250).pipe(Effect.provideService(PluginPaths, paths))),
      ).rejects.toThrow()
      expect(fake.unexpected).toEqual(["nope"])
    } finally {
      await fake.close()
    }
  })
})
