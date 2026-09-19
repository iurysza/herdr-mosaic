# Step 5 Linux: tint, intensity, preview, presentation

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

`tint-enable` writes generated theme values under the plugin lock, captures
`theme_backup` once (TINT_KEYS ∪ OVERLAY_KEYS), reloads once, and no-ops when
`last_tint` and the live doc already match. User-edited owned keys skip without
`--force` and apply with `--force`. Semantic slots such as `theme.custom.red`
are never written. `tint-disable` / `theme-restore` restore the backup
byte-exactly. No focused workspace still sets `tint_enabled`.

`intensity` prints or sets subtle/medium/bold without enabling tint. `preview`
and `tint-preview` print truecolor swatches. `marker`, `announce`, `list` /
`list-colors`, `state`, and `repalette --dry-run` go through the production CLI.
Reconcile reapplies tint and the window title when tint is enabled.

Title/elapsed publish and `refresh.start` are not wired.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 168 pass
- `python3 scripts/check-parity-inventory.py` 105 entrypoints
