# Step 5 Linux: pane-move capture and promote

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

`move-pane` first captures the focused pane into `pending_pane_move` and shows a
quiet notification. The second press opens the `pane-move` popup with
`MOSAIC_PANE_MOVE_SOURCE` / `MOSAIC_PANE_MOVE_DESTINATION`. A missing source
clears the selection. Confirmed split moves to the right of the destination at
ratio 0.5 and clears the selection. Split onto the same pane is refused; a new
tab from the same pane is allowed.

`promote-pane` moves the focused pane to a new tab in its workspace and does not
consume `pending_pane_move`.

`pane-move` is the confirmation entry: extra argv prints usage, missing env
requires source and destination IDs, and a non-TTY exits with the frozen Python
message. The confirmation TUI is ported in `evidence/step-5-tui.md`.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 242 pass
- `python3 scripts/check-parity-inventory.py` 105 entrypoints
