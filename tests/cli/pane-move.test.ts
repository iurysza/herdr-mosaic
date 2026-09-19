import { join } from "node:path"

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { runCli } from "../../src/cli.ts"
import {
  confirmMove,
  placementForKey,
} from "../../src/panes/pane-move.ts"
import { PluginPaths } from "../../src/runtime/paths.ts"
import { defaultState, load, save } from "../../src/state/store.ts"
import type { JsonObject } from "../../src/runtime/rpc.ts"
import { FakeHerdr } from "../support/fake-herdr.ts"
import { makeSandbox } from "../support/sandbox.ts"

async function run(argv: readonly string[], extraEnv: { [key: string]: string }) {
  const previous = { ...process.env }

  Object.assign(process.env, extraEnv)

  try {
    return await Effect.runPromise(runCli(argv).pipe(Effect.provide(PluginPaths.layer)))
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key]
    }

    Object.assign(process.env, previous)
  }
}

function required(env: { [key: string]: string }, key: string): string {
  const value = env[key]

  if (value === undefined || value === "") throw new Error(`missing ${key}`)

  return value
}

function paneEnv(env: { [key: string]: string }, paneId: string) {
  return { ...env, HERDR_PANE_ID: paneId }
}

function panes(): JsonObject[] {
  return [
    {
      pane_id: "w1:p1",
      workspace_id: "w1",
      tab_id: "w1:t1",
      terminal_title_stripped: "Source",
    },
    {
      pane_id: "w2:p2",
      workspace_id: "w2",
      tab_id: "w2:t2",
      terminal_title_stripped: "Destination",
    },
  ]
}

describe("placementForKey", () => {
  test("explicit placement keys do not depend on enter variants", () => {
    expect(placementForKey("s".charCodeAt(0))).toBe("split")
    expect(placementForKey("S".charCodeAt(0))).toBe("split")
    expect(placementForKey("t".charCodeAt(0))).toBe("tab")
    expect(placementForKey("T".charCodeAt(0))).toBe("tab")
    expect(placementForKey("\n".charCodeAt(0))).toBeUndefined()
    expect(placementForKey("\r".charCodeAt(0))).toBeUndefined()
  })
})

describe("move-pane CLI", () => {
  test("first invocation captures the source and notifies quietly", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")

    fake.on("pane.list", () => ({ panes: panes() }))
    fake.on("notification.show", () => ({}))
    await fake.listen()

    try {
      const result = await run(["move-pane"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(0)
      expect(load(statePath).pending_pane_move).toEqual({ pane_id: "w1:p1" })
      expect(fake.requests).toEqual([
        expect.objectContaining({ method: "pane.list" }),
        expect.objectContaining({
          method: "notification.show",
          params: {
            title: "Mosaic",
            body: "Pane selected. Navigate, then press prefix+/ again.",
            sound: "none",
          },
        }),
      ])
    } finally {
      await fake.close()
    }
  })

  test("second invocation opens confirmation for the captured source", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.pending_pane_move = { pane_id: "w1:p1" }
    save(statePath, state)
    fake.on("pane.list", () => ({ panes: panes() }))
    fake.on("plugin.pane.open", () => ({}))
    await fake.listen()

    try {
      const result = await run(["move-pane"], paneEnv(sandbox.env, "w2:p2"))

      expect(result.code).toBe(0)
      expect(load(statePath).pending_pane_move).toEqual({ pane_id: "w1:p1" })
      expect(fake.requests.some((request) =>
        request.method === "plugin.pane.open"
        && request.params.entrypoint === "pane-move"
        && request.params.focus === true
        && request.params.placement === "popup"
      )).toBe(true)

      const opened = fake.requests.find((request) => request.method === "plugin.pane.open")
      const env = opened?.params.env

      expect(env).toEqual({
        MOSAIC_PANE_MOVE_SOURCE: "w1:p1",
        MOSAIC_PANE_MOVE_DESTINATION: "w2:p2",
      })
    } finally {
      await fake.close()
    }
  })

  test("a missing source clears the stale selection", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.pending_pane_move = { pane_id: "gone" }
    save(statePath, state)
    fake.on("pane.list", () => ({ panes: panes().filter((pane) => pane.pane_id === "w2:p2") }))
    fake.on("notification.show", () => ({}))
    await fake.listen()

    try {
      const result = await run(["move-pane"], paneEnv(sandbox.env, "w2:p2"))

      expect(result.code).toBe(0)
      expect(load(statePath).pending_pane_move).toBeNull()
      expect(fake.requests.some((request) => request.method === "notification.show")).toBe(true)
    } finally {
      await fake.close()
    }
  })
})

describe("confirmMove", () => {
  test("confirmed split moves right of the destination and clears selection", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.pending_pane_move = { pane_id: "w1:p1" }
    save(statePath, state)
    fake.on("pane.list", () => ({ panes: panes() }))
    fake.on("pane.move", () => ({ move_result: { changed: true } }))
    await fake.listen()

    const previous = { ...process.env }

    Object.assign(process.env, sandbox.env)

    try {
      const outcome = await Effect.runPromise(
        confirmMove("w1:p1", "w2:p2", "split").pipe(Effect.provide(PluginPaths.layer)),
      )

      expect(outcome).toBe("moved")
      expect(fake.requests.find((request) => request.method === "pane.move")?.params).toEqual({
        pane_id: "w1:p1",
        destination: {
          type: "tab",
          tab_id: "w2:t2",
          target_pane_id: "w2:p2",
          split: "right",
          ratio: 0.5,
        },
        focus: true,
      })
      expect(load(statePath).pending_pane_move).toBeNull()
    } finally {
      await fake.close()

      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }

      Object.assign(process.env, previous)
    }
  })

  test("same pane refuses split but allows a new tab", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.pending_pane_move = { pane_id: "w1:p1" }
    save(statePath, state)
    fake.on("pane.list", () => ({ panes: panes() }))
    fake.on("pane.move", () => ({ move_result: { changed: true } }))
    await fake.listen()

    const previous = { ...process.env }

    Object.assign(process.env, sandbox.env)

    try {
      const split = await Effect.runPromise(
        confirmMove("w1:p1", "w1:p1", "split").pipe(Effect.provide(PluginPaths.layer)),
      )

      expect(split).toBe("same_pane")
      expect(load(statePath).pending_pane_move).toEqual({ pane_id: "w1:p1" })

      const tab = await Effect.runPromise(
        confirmMove("w1:p1", "w1:p1", "tab").pipe(Effect.provide(PluginPaths.layer)),
      )

      expect(tab).toBe("moved")
      expect(fake.requests.find((request) => request.method === "pane.move")?.params.destination)
        .toEqual({
          type: "new_tab",
          workspace_id: "w1",
        })
      expect(load(statePath).pending_pane_move).toBeNull()
    } finally {
      await fake.close()

      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }

      Object.assign(process.env, previous)
    }
  })

  test("a missing destination keeps the selection", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.pending_pane_move = { pane_id: "w1:p1" }
    save(statePath, state)
    fake.on("pane.list", () => ({ panes: panes().filter((pane) => pane.pane_id === "w1:p1") }))
    await fake.listen()

    const previous = { ...process.env }

    Object.assign(process.env, sandbox.env)

    try {
      const outcome = await Effect.runPromise(
        confirmMove("w1:p1", "w2:p2", "split").pipe(Effect.provide(PluginPaths.layer)),
      )

      expect(outcome).toBe("destination_missing")
      expect(load(statePath).pending_pane_move).toEqual({ pane_id: "w1:p1" })
    } finally {
      await fake.close()

      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }

      Object.assign(process.env, previous)
    }
  })
})

describe("promote-pane CLI", () => {
  test("moves the focused pane without touching a pending selection", async () => {
    const sandbox = makeSandbox()
    const fake = new FakeHerdr(required(sandbox.env, "HERDR_SOCKET_PATH"))
    const statePath = join(required(sandbox.env, "HERDR_PLUGIN_STATE_DIR"), "state.json")
    const state = defaultState()

    state.pending_pane_move = { pane_id: "w2:p2" }
    save(statePath, state)
    fake.on("pane.list", () => ({ panes: panes() }))
    fake.on("pane.move", () => ({ move_result: { changed: true } }))
    await fake.listen()

    try {
      const result = await run(["promote-pane"], paneEnv(sandbox.env, "w1:p1"))

      expect(result.code).toBe(0)
      expect(fake.requests.find((request) => request.method === "pane.move")?.params.destination)
        .toEqual({
          type: "new_tab",
          workspace_id: "w1",
        })
      expect(load(statePath).pending_pane_move).toEqual({ pane_id: "w2:p2" })
    } finally {
      await fake.close()
    }
  })
})

describe("pane-move CLI", () => {
  test("without source and destination pane IDs exits 1", async () => {
    const sandbox = makeSandbox()
    const result = await run(["pane-move"], sandbox.env)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("pane-move requires source and destination pane IDs")
  })

  test("extra argv prints usage", async () => {
    const sandbox = makeSandbox()
    const result = await run(["pane-move", "extra"], sandbox.env)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("usage: pane-move")
  })

  test("needs a terminal when source and destination are set", async () => {
    const sandbox = makeSandbox()

    const result = await run(["pane-move"], {
      ...sandbox.env,
      MOSAIC_PANE_MOVE_SOURCE: "w1:p1",
      MOSAIC_PANE_MOVE_DESTINATION: "w2:p2",
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("pane-move needs a terminal; run it through the Mosaic action.")
  })
})
