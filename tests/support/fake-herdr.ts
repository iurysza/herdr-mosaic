import { createServer, type Socket } from "node:net"
import { unlinkSync } from "node:fs"

import { Result, Schema } from "effect"

import { PLUGIN_ID } from "../../src/ids.ts"
import type { JsonObject } from "../../src/runtime/rpc.ts"

export type RpcHandler = (
  method: string,
  params: JsonObject,
  id: string,
) => JsonObject | { readonly error: { readonly code: string; readonly message: string } }

const IncomingRequest = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.JsonObject),
})

export class FakeHerdr {
  readonly requests: { readonly method: string; readonly params: JsonObject; readonly id: string }[] = []
  readonly unexpected: string[] = []
  private readonly handlers = new Map<string, RpcHandler>()
  private readonly server = createServer((socket) => this.onConnection(socket))
  private readonly unsolicited: string[] = []

  constructor(readonly socketPath: string) {}

  on(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler)
  }

  queueUnsolicited(message: JsonObject): void {
    this.unsolicited.push(`${JSON.stringify(message)}\n`)
  }

  async listen(): Promise<void> {
    try {
      unlinkSync(this.socketPath)
    } catch {
      // missing socket is the common first-listen case
    }

    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(this.socketPath, () => {
        this.server.off("error", reject)
        resolve()
      })
    })
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })

    try {
      unlinkSync(this.socketPath)
    } catch {
      // already removed
    }
  }

  private onConnection(socket: Socket): void {
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) this.handleLine(socket, line)
    })
  }

  private handleLine(socket: Socket, line: string): void {
    if (line.trim() === "") return

    let parsed: unknown

    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }

    const decoded = Schema.decodeUnknownResult(IncomingRequest)(parsed)

    if (Result.isFailure(decoded)) return

    const message = decoded.success
    const id = message.id ?? ""
    const method = message.method ?? ""
    const params = message.params ?? {}

    this.requests.push({ method, params, id })

    for (const event of this.unsolicited) socket.write(event)

    const handler = this.handlers.get(method)

    if (handler === undefined && method === "plugin.list") {
      const root = process.env.HERDR_PLUGIN_ROOT ?? ""

      const plugins = root === ""
        ? []
        : [{ plugin_id: PLUGIN_ID, enabled: true, plugin_root: root }]

      socket.write(`${JSON.stringify({ id, result: { plugins } })}\n`)

      return
    }

    if (handler === undefined) {
      this.unexpected.push(method)
      socket.destroy()

      return
    }

    const reply = handler(method, params, id)

    if ("error" in reply) {
      socket.write(`${JSON.stringify({ id, error: reply.error })}\n`)

      return
    }

    socket.write(`${JSON.stringify({ id, result: reply })}\n`)
  }
}
