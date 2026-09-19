# Step 4 Linux: install, doctor, uninstall

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

`install --dry-run` prints the migrate-only warning and delegates to migrate.
Successful `install` runs migrate → sidebar → six keybinds → Window Manager
action rename (save records before commit) → `view` with stored mode →
`reconcile`. `doctor` is read-only and always exits 0; every
`ui.sidebar.agents.rows_by_agent.*` entry is a problem. `uninstall` restores
Mosaic theme/sidebar backups and keybinds in one commit, clears the plugin
agent view plus title/elapsed tokens (never `$themed_model_tier`), and keeps
identities.

Agent view scope and sort are independent. A failed `agent.view.set` does not
persist `view_installed`. Reconcile reapplies an owned view. Tint apply and
post-success `publish_once` / `refresh.start` are not wired yet.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 145 pass
- `python3 scripts/check-parity-inventory.py` 105 entrypoints
