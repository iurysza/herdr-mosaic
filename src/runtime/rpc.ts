import { connect } from "node:net"

import { Duration, Effect, Result, Schema } from "effect"

import { PLUGIN_ID } from "../ids.ts"
import { RpcTransportError } from "./errors.ts"
import { PluginPaths } from "./paths.ts"

export type JsonObject = typeof Schema.JsonObject.Type

const RpcErrorBody = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
})

const RpcMessage = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(RpcErrorBody),
})

function requestId(): string {
  return `${PLUGIN_ID}-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`
}

const connectAndCall = Effect.fnUntraced(function*(
  socketPath: string,
  method: string,
  params: JsonObject,
) {
  return yield* Effect.callback<JsonObject, RpcTransportError>((resume, signal) => {
    const socket = connect(socketPath)
    const id = requestId()
    let buffer = ""
    let settled = false

    const finish = (outcome: JsonObject | RpcTransportError) => {
      if (settled) return
      settled = true
      socket.destroy()

      if (outcome instanceof RpcTransportError) resume(outcome)
      else resume(Effect.succeed(outcome))
    }

    const onAbort = () => {
      finish(new RpcTransportError({
        code: "no_response",
        message: `socket closed before a reply for ${method}`,
      }))
    }

    signal.addEventListener("abort", onAbort, { once: true })

    socket.on("error", (error) => {
      finish(new RpcTransportError({
        code: "socket_unavailable",
        message: `${socketPath} (${error.message})`,
      }))
    })
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`)
    })
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (line.trim() === "") continue

        let parsed: unknown

        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }

        const decoded = Schema.decodeUnknownResult(RpcMessage)(parsed)

        if (Result.isFailure(decoded)) continue

        const message = decoded.success

        if (message.id !== id) continue

        if (message.error !== undefined) {
          finish(new RpcTransportError({
            code: message.error.code ?? "unknown",
            message: message.error.message ?? "",
          }))

          return
        }

        const result = Schema.decodeUnknownResult(Schema.JsonObject)(message.result ?? {})

        finish(Result.isSuccess(result) ? result.success : {})
      }
    })
    socket.on("end", () => {
      finish(new RpcTransportError({
        code: "no_response",
        message: `socket closed before a reply for ${method}`,
      }))
    })

    return Effect.sync(() => {
      signal.removeEventListener("abort", onAbort)

      if (!settled) {
        settled = true
        socket.destroy()
      }
    })
  })
})

export const rpcCall = Effect.fnUntraced(function*(
  method: string,
  params: JsonObject = {},
  timeoutMs = 10_000,
) {
  const paths = yield* PluginPaths

  return yield* connectAndCall(paths.socketPath, method, params).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () =>
        new RpcTransportError({
          code: "no_response",
          message: `socket closed before a reply for ${method}`,
        }),
    }),
  )
})
