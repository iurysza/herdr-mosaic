## Review

Verdict: **approve**. No correctness blockers. Lifecycle, migration, locking, and layout parity match the approved bundle plan. Residual risks are cutover/operational, plus a few formatting and CLI footguns that do not break semantic restore.

### Correct

- **Plugin identity.** `herdr-plugin.toml:1` and `src/ctx.py:16` use `iurysza.window-manager`. Manifest commands all use `/usr/bin/python3` and `$HERDR_PLUGIN_ROOT`; no `[[build]]`. `tests/test_bundle.py` `TestManifest` covers this.
- **Owned sidebar split.** Spaces keep `$sd_*` via `insert_tokens`; agents are replaced with the 15-token row (`state_icon`, `$elapsed`, 12 `$title_*`, `$themed_model_tier`) in `src/config_patch.py:57-64` and `415-456`. `refuse_agent_dots` (`375-386`) names the 16-token cap. Agents never receive `$sd_*`.
- **`rows_by_agent` is hands-off.** `install_sidebar` only writes `owned_sidebar_keys()` (`411-412`). Existing `rows_by_agent` entries are not created or rewritten (`tests/test_plugin.py` `test_existing_rows_by_agent_is_preserved`, `tests/test_bundle.py` `test_rows_by_agent_never_created_or_dotted`).
- **Config writes.** Only `config_patch.commit` writes `config.toml`, after baseline-aware `herdr config check` (`src/config_patch.py:160-185`, `214-228`).
- **Mutation locking.** Event/tint/sidebar/migrate/uninstall paths take `ctx.Lock`. Layouts do too (`src/layout_actions.py:179-183`). `cmd_install` (`src/main.py:1182-1188`) sequences migrate then sidebar; locks are not nested.
- **Migrate refuses stale Chromatic backups.** `src/migrate.py:139-147` records `sidebar_backup` / `theme_backup` / `last_written` as ignored and never copies them into this plugin’s restore fields. `snapshot_ownership_baseline` (`101-111`) captures live `ui.sidebar.spaces.rows` and `ui.sidebar.agents.rows`. Identity conflicts raise without `--force` (`152-160`). Chromatic files stay on disk.
- **Uninstall uses this plugin’s snapshot.** `cmd_uninstall` (`src/main.py:1106-1118`) restores `st["sidebar_backup"]`, not Chromatic state. After migrate, that backup is the live elapsed/title row (`tests/test_bundle.py` `test_uninstall_does_not_apply_stale_chromatic_absent_backup`).
- **Labels.** `src/labels.py:91-118` sets `origin=label` and skips `manual`. `metadata.reconcile` applies rules before `ensure_all`.
- **Layout parity with `0ef0a8d5`.** Same presets, insertion plan, staging-tab reshape, recovery, zoomed refusal, single-pane no-op, resize `0.02`. Python 3.6 syntax (`midpoint / float(len(ids))`, no walrus/f-strings). Herdr calls go through `rpc.py`. Unit tests match upstream `test/test_layouts.py` plus lock/dispatch tests.
- **Elapsed/tier stay external.** Template consumes `$elapsed` / `$title_*` / `$themed_model_tier`; nothing publishes them.
- **Tests.** `/usr/bin/python3 -m py_compile src/*.py tests/*.py` exit 0. `/usr/bin/python3 -m unittest discover -s tests -t tests` — **146 tests, OK, 0.319s**. Interpreter is 3.9.6. Tests isolate `HERDR_*` dirs; no live HOME/config/socket writes. Nothing staged.

### Blocker

- None.

### Note

Worth knowing before cutover; not merge-blocking.

1. **Restore is structurally exact, not always byte-exact on the live 15-token row.** `restore_backup` always `doc.set`s the parsed value (`src/config_patch.py:264-267`). Reproduced on the multi-line live template: uninstall flattens `ui.sidebar.agents.rows` to one line. Values still match `has_agent_template`; `herdr config check` still passes. `users_real` dumps-equality tests do not cover this template. If spaces.rows was absent, restore also leaves an empty `[ui.sidebar.spaces]` table (`cmd_uninstall` does not pass `tidy_tables` for sidebar; `test_exact_restoration_when_key_was_absent` tidies in the test only).
2. **Idempotent agents install does not record `last_written`.** Cutover path: live already has the template, so `cmd_sidebar_install` (`src/main.py:507-516`) saves with no agent change. Uninstall conflict detection then cannot see later user edits to `ui.sidebar.agents.rows` and will restore the migrate snapshot without `--force` warning.
3. **`install --dry-run` still mutates.** `cmd_install` (`1182-1188`) forwards argv to migrate, then always runs `cmd_sidebar_install`. `--dry-run` only applies inside `migrate.run` (`src/migrate.py:217-222`). Use `migrate --dry-run`, not `install --dry-run`.
4. **Picker key is not “if free”.** `install_keybind` only skips when *this command* is already bound (`src/config_patch.py:499-507`). Reproduced: existing `prefix+i` → `command.palette` still gets a second `[[keys.command]]` for `iurysza.window-manager.set-identity`. README claims “if free”; `cmd_install` always calls `cmd_keybind_install`. On this machine that collides with Command Palette, as cutover already says.
5. **`install` forces agent view `all`.** Migrated `view_mode=current` is overwritten by `cmd_view(["all"])` (`src/main.py:1186`).
6. **Re-migrate overwrites `ownership_baseline`.** `snapshot_ownership_baseline` always replaces it; `sidebar_backup` is only set when empty. Uninstall uses `sidebar_backup`, so this is unused-but-misleading state.
7. **`rows_by_agent` can hide the 15-token row.** Herdr still fully replaces `rows` for those agents (`docs/herdr-api-findings.md`). Doctor only prints `preserved` (`src/main.py:1008-1010`). If Chromatic previously dotted an existing `rows_by_agent` entry, that agent will not show elapsed/title. Plan forbids rewriting; doctor does not warn.
8. **Layout reshape is unit-tested only.** No isolated live server run. Upstream e2e was not re-run. `rpc.py` default timeout is 10s per call; `ctx.Lock` times out at 10s (upstream layout lock blocked forever on a separate `*.layout.lock`).
9. **Two writers, two lock files.** While Chromatic stays linked, it locks its own state dir and can still race `config.toml`. Documented in cutover.

### Optional ideas

- Skip `doc.set` on restore when parsed values already match, to keep live multi-line formatting.
- Tidy empty `ui.sidebar.spaces` / `agents` tables on uninstall, as the absent-key test already does.
- Record `last_written` for owned keys on idempotent install.
- Short-circuit `cmd_install` when `--dry-run` is set.
- Refuse picker bind when the key is already used, to match README.
- Doctor: warn that `rows_by_agent` replaces `rows`.
- Keep migrated `view_mode` instead of hard-coding `all`.
- Do not overwrite `ownership_baseline` once set.

### Verdict

**Approve.** Semantic ownership, stale-backup refusal, locking, 15-token cap, `rows_by_agent` preservation, and layout algorithm parity are evidenced in code and in 146 passing tests. Do not treat `install --dry-run` as safe. Uninstall may reformat the live agents row without changing tokens. Live reshape and Chromatic overlap remain cutover risks, not implementation defects.