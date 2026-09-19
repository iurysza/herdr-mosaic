# Step 5 Linux: titles, elapsed, refresh loop

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

`elapsed-publish` writes only `agent-elapsed` tokens with `ttl_ms` 45000 and
does not change `state.json`. Missing timestamps publish three U+2800 cells.
Sidebar `publishOnce` after successful `install`, `reconcile`, `apply-identity`,
and `repalette` writes `agent-sidebar-title` with no TTL and elapsed with the
45s TTL. Neither source includes `$themed_model_tier`.

`refresh-worker` now runs the publish loop under the generation lock and exits
0 on a singleton race. `runCli` calls `startRefreshWorker` after a successful
publish. Isolated CLI tests set `MOSAIC_TEST_ISOLATED` so the worker exits after
one round instead of sleeping 30 seconds.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 177 pass
- `bun run test:runtime` 11 pass
- `python3 scripts/check-parity-inventory.py` 105 entrypoints
