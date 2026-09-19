# Step 5 Linux: idle cycle and prune opener

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

`next-idle-agent` focuses the newest observed settled agent, wraps, skips the
focused pane, and writes `idle_cycle_last_pane_id` only after a successful
`agent.focus`. Extra argv exits 1. No settled agent prints
`no other idle agent is available` and exits 0.

`prune-stale-agents` opens the prune popup and sets `MOSAIC_PRUNE_PROTECTED_PANE`
to the agent focused before the popup. `closeSelected` re-reads live agents and
skips a pane that is no longer eligible. The prune TUI itself is not ported.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 219 pass
- `python3 scripts/check-parity-inventory.py` 105 entrypoints
