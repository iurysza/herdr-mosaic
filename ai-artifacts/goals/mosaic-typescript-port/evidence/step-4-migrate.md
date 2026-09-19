# Step 4 Linux: auto-assign and migrate

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs remain unrun here; the owner
will verify them after the PR is open.

## Commands

- `auto-assign` / `assign-colors`: plugin lock, `ensureAll` then metadata
  reconcile. `--force` drops only the context/focused workspace identity.
- `migrate`: plugin lock. Window Manager `state.json` copies byte-exact
  settings/identities/legacy layouts settings and `config.backup.*.toml`,
  writes `window-manager-import.json`, commits Mosaic `state.json` last.
  Existing Mosaic files are never overwritten, including with `--force`.
  Chromatic import refuses to apply `sidebar_backup` / `theme_backup` /
  `last_written`, snapshots live ownership, does not auto-enable tint.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 131 pass
- `python3 scripts/check-parity-inventory.py` 105 entrypoints

## Not in this slice

Keybinds, `install` / `doctor` / `uninstall`, title publish, `refresh.start`,
pastel luminance (`theme.ts`), crash-injection atomic writes.
