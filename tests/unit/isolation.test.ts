import { describe, expect, test } from "bun:test"

describe("test isolation", () => {
  test("fails closed onto a disposable HOME and socket", () => {
    expect(process.env.MOSAIC_TEST_ISOLATED).toBe("1")
    const home = process.env.HOME
    const socket = process.env.HERDR_SOCKET_PATH
    expect(home).toBeDefined()
    expect(socket).toBeDefined()
    expect(home?.includes("mosaic-test-")).toBe(true)
    expect(home?.endsWith("/home")).toBe(true)
    expect(socket?.startsWith(home ?? "")).toBe(true)
    expect(process.env.HERDR_BIN_PATH?.includes("missing-herdr")).toBe(true)

    const host = process.env.MOSAIC_HERDR_BIN

    expect(host === undefined || !host.includes("missing-herdr")).toBe(true)
  })

  test("child processes inherit the isolated HOME", async () => {
    const proc = Bun.spawn(
      ["python3", "-c", "import os; print(os.environ['HOME'])"],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env } },
    )

    const stdout = (await new Response(proc.stdout).text()).trim()
    expect(await proc.exited).toBe(0)
    const childHome = process.env.HOME

    if (childHome === undefined) throw new Error("HOME was not isolated")

    expect(stdout).toBe(childHome)
    expect(stdout.includes("mosaic-test-")).toBe(true)
    expect(stdout.endsWith("/home")).toBe(true)
  })
})
