import { describe, expect, test } from "bun:test"
import { Effect, Predicate, Result, Schema } from "effect"

import { RESIZE_AMOUNT } from "../../src/panes/layout-actions.ts"
import { runCli } from "../../src/cli.ts"
import { PluginPaths, pathsFromEnv } from "../../src/runtime/paths.ts"
import type { JsonObject } from "../../src/runtime/rpc.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

type Json = typeof Schema.Json.Type

async function run(argv: readonly string[], env: { [key: string]: string }) {
  const paths = PluginPaths.of(pathsFromEnv(env))

  return Effect.runPromise(runCli(argv).pipe(Effect.provideService(PluginPaths, paths)))
}

function required(env: { [key: string]: string }, key: string): string {
  const value = env[key]

  if (value === undefined || value === "") throw new Error(`missing ${key}`)

  return value
}

function paneEnv(env: { [key: string]: string }, paneId: string) {
  return { ...env, HERDR_PANE_ID: paneId }
}

function twoPaneLayout(zoomed = false): JsonObject {
  return {
    tab_id: "w1:t1",
    workspace_id: "w1",
    focused_pane_id: "w1:p1",
    zoomed,
    root: {
      type: "split",
      direction: "right",
      ratio: 0.7,
      first: { type: "pane", pane_id: "w1:p1" },
      second: { type: "pane", pane_id: "w1:p2" },
    },
  }
}

function singlePaneLayout(): JsonObject {
  return {
    tab_id: "w1:t1",
    workspace_id: "w1",
    focused_pane_id: "w1:p1",
    zoomed: false,
    root: { type: "pane", pane_id: "w1:p1" },
  }
}

function asObject(value: Json | undefined): JsonObject | undefined {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value ?? null)

  if (Result.isFailure(decoded)) return undefined

  return decoded.success
}

function jsonObject(value: Json): JsonObject {
  const decoded = Schema.decodeUnknownResult(Schema.JsonObject)(value)

  if (Result.isFailure(decoded)) return {}

  return decoded.success
}

function paneIdOf(params: JsonObject): string {
  return Predicate.isString(params.pane_id) ? params.pane_id : ""
}

function moveAccepted(paneId: string, createdTab?: string): JsonObject {
  if (createdTab === undefined) {
    return jsonObject({
      move_result: {
        changed: true,
        pane: { pane_id: paneId },
      },
    })
  }

  return jsonObject({
    move_result: {
      changed: true,
      pane: { pane_id: paneId },
      created_tab: { tab_id: createdTab },
    },
  })
}

describe("layout CLI", () => {
  test("resize requires a pane context", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("notification.show", () => ({}))
    await fake.listen()

    try {
      const result = await run(["layout", "resize-left"], sandbox.env)

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("resize action requires a pane context")
      expect(result.stderr).toContain("mosaic:")
    } finally {
      await fake.close()
    }
  })

  test("resize uses the plugin lock and a 2 percent amount", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("pane.resize", () => ({}))
    await fake.listen()

    try {
      const result = await run(["layout", "resize-left"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(0)

      const resize = fake.requests.find((request) => request.method === "pane.resize")

      expect(resize?.params).toEqual({
        pane_id: "w1:p1",
        direction: "left",
        amount: RESIZE_AMOUNT,
      })
      expect(RESIZE_AMOUNT).toBe(0.02)
    } finally {
      await fake.close()
    }
  })

  test("equalize on a single pane only exports", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("layout.export", () => ({ layout: singlePaneLayout() }))
    await fake.listen()

    try {
      const result = await run(["layout", "equalize"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(0)
      expect(fake.requests.map((request) => request.method)).toEqual(["layout.export"])
    } finally {
      await fake.close()
    }
  })

  test("zoomed tabs fail before any move", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("layout.export", () => ({ layout: twoPaneLayout(true) }))
    fake.on("notification.show", () => ({}))
    await fake.listen()

    try {
      const result = await run(["layout", "equalize"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("unzoom the tab before changing its layout")
      expect(fake.requests.some((request) => request.method === "pane.move")).toBe(false)
    } finally {
      await fake.close()
    }
  })

  test("equalize stages through a new tab then reinserts", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("layout.export", () => ({ layout: twoPaneLayout() }))
    fake.on("pane.move", (_method, params) => {
      const dest = asObject(params.destination) ?? {}
      const paneId = paneIdOf(params)

      if (dest.type === "new_tab") return moveAccepted(paneId, "w1:t-staging")

      return moveAccepted(paneId)
    })
    await fake.listen()

    try {
      const result = await run(["layout", "equalize"], paneEnv(sandbox.env, "w1:p1"))

      const moves = fake.requests
        .filter((request) => request.method === "pane.move")
        .map((request) => asObject(request.params.destination) ?? {})

      expect(result.code).toBe(0)
      expect(moves[0]?.type).toBe("new_tab")
      expect(moves[0]?.workspace_id).toBe("w1")
      expect(moves[1]?.type).toBe("tab")
      expect(moves[1]?.tab_id).toBe("w1:t1")
      expect(moves[1]?.target_pane_id).toBe("w1:p1")
      expect(moves[1]?.split).toBe("right")
      expect(moves[1]?.ratio).toBeCloseTo(0.5)
    } finally {
      await fake.close()
    }
  })

  test("layout errors use the mosaic prefix", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("pane.resize", () => ({ error: { code: "boom", message: "nope" } }))
    fake.on("notification.show", () => ({}))
    await fake.listen()

    try {
      const result = await run(["layout", "resize-left"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("mosaic:")
      expect(result.stderr).not.toContain("pane-layouts:")
    } finally {
      await fake.close()
    }
  })

  test("arrange-columns aliases to equalize", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("layout.export", () => ({ layout: singlePaneLayout() }))
    await fake.listen()

    try {
      const result = await run(["arrange-columns"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(0)
      expect(fake.requests.map((request) => request.method)).toEqual(["layout.export"])
    } finally {
      await fake.close()
    }
  })

  test("next-layout aliases to cycle", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("layout.export", () => ({ layout: singlePaneLayout() }))
    await fake.listen()

    try {
      const result = await run(["next-layout"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(0)
      expect(fake.requests.map((request) => request.method)).toEqual(["layout.export"])
    } finally {
      await fake.close()
    }
  })

  test("a failed reinsert recovers panes onto the original tab", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    let moves = 0

    fake.on("layout.export", (_method, params) => {
      if (params.tab_id === "w1:t-staging") {
        return {
          layout: {
            tab_id: "w1:t-staging",
            workspace_id: "w1",
            focused_pane_id: "w1:p2",
            zoomed: false,
            root: { type: "pane", pane_id: "w1:p2" },
          },
        }
      }

      if (params.tab_id === "w1:t1") {
        return {
          layout: {
            tab_id: "w1:t1",
            workspace_id: "w1",
            focused_pane_id: "w1:p1",
            zoomed: false,
            root: { type: "pane", pane_id: "w1:p1" },
          },
        }
      }

      return { layout: twoPaneLayout() }
    })
    fake.on("pane.move", (_method, params) => {
      moves += 1
      const dest = asObject(params.destination) ?? {}
      const paneId = paneIdOf(params)

      if (dest.type === "new_tab") return moveAccepted(paneId, "w1:t-staging")

      if (moves === 2) {
        return jsonObject({ move_result: { changed: false, reason: "injected" } })
      }

      return moveAccepted(paneId)
    })
    fake.on("notification.show", () => ({}))
    await fake.listen()

    try {
      const result = await run(["layout", "equalize"], paneEnv(sandbox.env, "w1:p1"))
      const recovered = fake.requests.filter((request) => request.method === "pane.move")[2]

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("pane.move: injected")
      expect(result.stderr).not.toContain("recovery failed")
      expect(asObject(recovered?.params.destination)).toEqual({
        type: "tab",
        tab_id: "w1:t1",
        target_pane_id: "w1:p1",
        split: "right",
        ratio: 0.5,
      })
    } finally {
      await fake.close()
    }
  })

  test("a failed recovery reports that panes remain on the staging tab", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))

    fake.on("layout.export", (_method, params) => {
      if (params.tab_id === "w1:t-staging") {
        return {
          layout: {
            tab_id: "w1:t-staging",
            workspace_id: "w1",
            focused_pane_id: "w1:p2",
            zoomed: false,
            root: { type: "pane", pane_id: "w1:p2" },
          },
        }
      }

      if (params.tab_id === "w1:t1") {
        return {
          layout: {
            tab_id: "w1:t1",
            workspace_id: "w1",
            focused_pane_id: "w1:p1",
            zoomed: false,
            root: { type: "pane", pane_id: "w1:p1" },
          },
        }
      }

      return { layout: twoPaneLayout() }
    })
    fake.on("pane.move", (_method, params) => {
      const dest = asObject(params.destination) ?? {}
      const paneId = paneIdOf(params)

      if (dest.type === "new_tab") return moveAccepted(paneId, "w1:t-staging")

      return jsonObject({ move_result: { changed: false, reason: "injected" } })
    })
    fake.on("notification.show", () => ({}))
    await fake.listen()

    try {
      const result = await run(["layout", "equalize"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(1)
      expect(result.stderr).toContain("pane.move: injected")
      expect(result.stderr).toContain("recovery failed; panes remain in w1:t-staging")
    } finally {
      await fake.close()
    }
  })
})
