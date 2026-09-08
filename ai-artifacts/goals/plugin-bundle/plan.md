# Plugin bundle integration plan

Worktree: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-bundle`
Branch: `implementation-bundle` (requested `implementation/bundle` is illegal while `implementation` exists)
Base: `910c3daf04124c91afe4c0f01a09c0442658ead5`

## Contract

Single plugin `iurysza.window-manager` in this repository. Stdlib Python 3.6+, `/usr/bin/python3`, no uv/typed rewrite.

Owns:

- Chromatic identity, picker, optional tint, grouped agent view, startup reconcile
- Spaces sidebar: `$sd_*` dots + `workspace` / `branch` / `git_status`
- Agents sidebar: `state_icon` + `$elapsed` + 12 `$title_*` + `$themed_model_tier` (15 tokens; keep blanks; no `$sd_*`)
- Existing Pane Layouts actions (equalize, cycle, 2% resize), process-preserving reshape

Consumes, does not absorb: `herdr-agent-elapsed` title/elapsed tokens and themed `$themed_model_tier`.

Deferred: last-focus. Out of scope: agents/chezmoi cutover implementation, live config mutation, source-checkout edits.

## Seams

1. Re-id plugin (`ctx.PLUGIN_ID`, manifest, metadata/view source, keybind command).
2. Split sidebar install: dots only on spaces; replace agents `rows` with the 15-token template; never create or rewrite `rows_by_agent`.
3. Import `layouts.py` (3.6 syntax) and drive Herdr through `rpc.py` under `ctx.Lock`.
4. Explicit migrate: copy Chromatic identities/settings and label rules; copy layouts settings if present; never apply Chromatic `sidebar_backup` / `theme_backup` / `last_written`. Snapshot live config as the new restore baseline. Fail on identity conflicts without `--force`.
5. Apply portable label→colour rules when origin is not `manual`.
6. Tests: existing suite + token-limit, `rows_by_agent` preservation, idempotence, conflicts, exact rollback, stale-backup migration, layouts dispatch/lock, manifest interpreter paths. Real `herdr config check` on isolated files. No live Herdr mutations unless a fully isolated disposable session is guaranteed.

## Unresolved

None that block implementation. Isolated live-session smoke is skipped if HOME/config/socket/registry cannot be separated from the default session.
