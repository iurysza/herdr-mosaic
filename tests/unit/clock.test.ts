import { describe, expect, test } from "bun:test"
import { Clock, Duration, Effect } from "effect"

describe("application vs subprocess time", () => {
  test("an injected clock advances without waiting on the wall clock", async () => {
    const wallStart = Date.now()
    let now = 0

    const testClock: Clock.Clock = {
      currentTimeMillisUnsafe: () => now,
      currentTimeMillis: Effect.sync(() => now),
      monotonicTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      monotonicTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
      currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
      sleep: (duration) =>
        Effect.sync(() => {
          now += Duration.toMillis(duration)
        }),
    }

    await Effect.runPromise(
      Effect.sleep("5 seconds").pipe(Effect.provideService(Clock.Clock, testClock)),
    )

    expect(now).toBe(5_000)
    expect(Date.now() - wallStart).toBeLessThan(1_000)
  })
})
