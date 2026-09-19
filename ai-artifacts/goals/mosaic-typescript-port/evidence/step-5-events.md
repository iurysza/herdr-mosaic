# Step 5 Linux: event dispatcher and last-settled tracking

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

`event` dispatches argv or `HERDR_PLUGIN_EVENT`. Unhandled names warn and exit 0.
`workspace.focused` uses live `workspace.list` focus, not the payload.
`workspace.created` assigns identity and publishes. `workspace.renamed` keeps
identity and republishes agent panes. `workspace.closed` keeps identity and
clears matching `last_tint`.

`pane.agent_status_changed` records last-settled using receipt time.
`working → idle/done` is a completion; blocked/unknown are not.
`pane.agent_detected` initialises a launch clock once; `released: true` is not
a launch. `pane.moved` does not start a clock. `pane.closed` / `pane.exited`
drop occupancy so a reused pane id cannot inherit the previous clock.
`$themed_model_tier` is never copied into settled records.

`tab.renamed` is a handler no-op. Post-success `publishOnce` and
`startRefreshWorker` are wired for the refresh events.

`workspaceIdOfPane` splits on the first colon (`w1:p1` → `w1`). JavaScript
`split(":", 1)` would have returned the whole pane id.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 208 pass
- `python3 scripts/check-parity-inventory.py` 105 entrypoints
