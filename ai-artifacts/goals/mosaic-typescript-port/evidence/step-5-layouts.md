# Step 5 Linux: pane layouts

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

`layout resize-*` requires a pane context (`HERDR_PANE_ID` or invocation context),
runs under the plugin lock, and calls `pane.resize` with amount `0.02`.

`layout equalize` and `layout cycle` export the current tab, skip work when there
is one pane or the tree already matches the target, refuse zoomed tabs before any
move, and otherwise stage leftover panes into a `new_tab` then reinsert along the
preset insertion plan. A rejected reinsert recovers panes onto the original tab
or writes `mosaic: recovery failed; panes remain in …`. Failures prefix stderr
with `mosaic:`, never `pane-layouts:`.

`arrange-columns` rewrites to `layout equalize`. `next-layout` rewrites to
`layout cycle`.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 242 pass
- `python3 scripts/check-parity-inventory.py` 105 entrypoints
