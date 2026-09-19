# Step 3 Linux: reversible sidebar install/remove

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated cloud checkout. Default Herdr session, user settings, and live registration were not used.

macOS remains an open step-2 completion gate (fact-09 / fact-20). This slice was implemented and proven on Linux only.

## What landed

- Surgical TOML editor (`src/config/toml-edit.ts`) with Python `splitlines` semantics, CRLF, missing trailing newline, comment preservation, and exact round-trip of the frozen `REAL_CONFIG` fixture.
- Sidebar config patch (`src/config/patch.ts`): owned keys `ui.sidebar.spaces.rows` and `ui.sidebar.agents.rows`, `$sd_*` dots on spaces, 15-token agent template, never create/rewrite `rows_by_agent`, baseline-aware `herdr config check`, atomic commit, absent-versus-present backup.
- Production CLI handlers `sidebar-install` / `sidebar-remove` under the plugin lock.
- Durable `state.json` load/save (`src/state/store.ts`) matching Python key sort and sidebar backup shape.
- Fake Herdr `config check` plus a PATH-safe wrapper (`installFakeHerdr`) so the default suite does not require a real binary.

## Commands

```
bun run typecheck
bun run lint
bun run test
python3 scripts/check-parity-inventory.py
```

Linux x86_64 results: typecheck pass, lint pass, default suite 95 pass, parity inventory 105 entrypoints.

## Observations

- Install on `users_real` writes dots after `state_icon` and replaces agent rows with the elapsed/title/tier template.
- Repeat install prints `sidebar already carries the plugin templates; nothing to do` and does not rewrite config bytes.
- Remove restores exact fixture bytes when there is no conflict.
- `not_a_real_token` is rejected; live config bytes stay unchanged.
- `legacy_unknown_key` in the baseline is tolerated.
- Pre-existing `rows_by_agent.claude` remains byte-stable in the table body.
- User edit of an owned key is skipped on remove without `--force` and restored with `--force`.
- Python `state.load()` reads TypeScript-written `sidebar_backup` present/value records.

## Still open

- macOS flock / worker / PTY / artifact / real-Herdr proofs from step 2.
- Full install, identity, migration, doctor, and uninstall (step 4).
- Real Herdr `config check` against every fixture remains a later disposable-HOME job; the default suite uses the fake validator contract.
