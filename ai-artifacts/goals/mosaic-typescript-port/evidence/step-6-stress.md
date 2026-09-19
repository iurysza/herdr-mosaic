# Step 6 Linux stress boundaries

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default Herdr session unused. macOS native proofs remain owner-run after the PR is open.

Faults were injected at the fake Herdr socket, the fake `herdr` executable, leftover tmp files, SIGKILL of a waiter, and overlapping subprocesses. Application modules were not patched.

## Cases

| Boundary | Fault | Observation |
| --- | --- | --- |
| Overlapping hooks | Two `event pane.agent_status_changed` processes | Both panes recorded; `state.json` remains parseable JSON |
| Lock contention | Holder then two events | Events wait; both mutations land |
| Interrupted waiter | SIGKILL of a lock waiter | Next event acquires the lock and writes |
| Worker-start race | `hold-worker` owns the generation lock | `startRefreshWorker` returns pid 0 twice |
| Socket replacement | Worker started with a stale generation key | Exit 0; no `pane.report_metadata` |
| Fragmented RPC | Half-reply, 25 ms delay | Client reassembles `{ ok: true, note: "fragmented-reply" }` |
| Interleaved events | Unsolicited event, wrong id, `{not-json` line | Matching ping still succeeds |
| Malformed result | `result` is `[1,2,3]` | Client returns `{}` |
| External edit | User rewrite of `config.toml` while lock is held | Event writes state; config bytes stay the user edit |
| Interrupted write | Crash helper writes `.state.json.tmp.PID` then hangs | Live JSON unchanged |
| Concurrent writers | Four `atomicWrite` processes | Live file always complete JSON |
| Stale selection | Missing destination pane | `confirmMove` returns `destination_missing`; pending source kept |
| Partial layout | Every post-staging `pane.move` rejected | stderr `recovery failed; panes remain in w1:t-staging` |
| Token limits | 17-token agents row | `checkLimits` rejects; doctor warns and still exits 0 |

## Commands

```sh
bun run typecheck
bun run lint
bun run test
bun run test:runtime
python3 scripts/check-parity-inventory.py
```

Linux x86_64: typecheck pass, lint pass, 271 default tests, 25 runtime tests, 105 inventory entrypoints.
