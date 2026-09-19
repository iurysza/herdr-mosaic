# Step 5 Linux: picker, board, prune, and pane-move TUIs

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

`set-identity` / `pick-color` open the picker popup with `SPACE_IDENTITY_TARGET`.
`picker` is the pane entry: non-TTY uses the frozen Python message, `q` prints
`cancelled` and exits 0, Enter saves a palette colour, and custom hex is a
separate prompt where `q` is a character.

`board-open` / `agent-board` open the board pane. `board --once` dumps grouped
agents without a TTY. The live board groups by workspace, sorts agents by
status then pane id, and Space/Enter collapses a group or focuses an agent.

`prune` is the pane entry: extra argv prints usage, non-TTY uses the frozen
Python message, and `q` exits 0 without closing panes. Column layout matches
the Python pruner (`SEL`/`AGE`/`STATE`/`AGENT`/`SESSION`).

`pane-move` confirmation shows FROM/TO, `[S]` split right, `[T]` new tab, and
`[Q]` cancel. Cancel clears `pending_pane_move` under the plugin lock.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 265 pass
- `bun run test:runtime` 15 pass, including four scripted PTY TUI tests
- `python3 scripts/check-parity-inventory.py` 105 entrypoints
