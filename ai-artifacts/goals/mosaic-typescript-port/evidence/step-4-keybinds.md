# Step 4 Linux: keybinds

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout.
Default Herdr session unused. macOS native proofs will be run by the owner after
the PR is open.

## Commands

Picker, sort, idle, prune, pane-move, and promote install/remove. Occupied keys
are left alone. Sort does not claim a pre-existing user binding. Managed remove
requires the Mosaic-owned flag.

## Validation (Linux x86_64)

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 137 pass
