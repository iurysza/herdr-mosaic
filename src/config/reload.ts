import { Effect, Result } from "effect"

import { RpcTransportError } from "../runtime/errors.ts"
import { pluginWarn, type CapturedOutput } from "../runtime/plugin-log.ts"
import type { PluginPathValues } from "../runtime/paths.ts"
import { rpcCall } from "../runtime/rpc.ts"

export const reloadConfig = Effect.fnUntraced(function*(
  paths: PluginPathValues,
  output: CapturedOutput,
) {
  const result = yield* rpcCall("server.reload_config", {}).pipe(
    Effect.result,
  )

  if (Result.isFailure(result)) {
    const error = result.failure

    if (error instanceof RpcTransportError) {
      yield* pluginWarn(paths, output, `config reload failed: ${error.code}: ${error.message}`)
    }

    return
  }

  const diagnostics = result.success.diagnostics

  if (!Array.isArray(diagnostics)) return

  for (const diagnostic of diagnostics) {
    yield* pluginWarn(paths, output, `reload diagnostic: ${String(diagnostic)}`)
  }
})
