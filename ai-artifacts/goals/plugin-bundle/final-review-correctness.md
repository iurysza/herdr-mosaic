## Review
- Correct: Ownership split, stale-Chromatic-backup refusal, first-cycle rollback, `ctx.Lock` on mutations, and layout algorithm/lock dispatch match the approved plan. Prior Grok notes that this lane asked to fix are resolved in code and in 156 passing tests.
- Blocker: Uninstall leaves `ownership_baseline` in place; the next `migrate`/`install` reuses that stale snapshot as `sidebar_backup`, so a later uninstall restores the first take-ownership rows instead of the current pre-plugin config.
- Note: Live reshape/recovery still unproven; Python 3.6 is syntax-only; two writers remain a cutover risk.

---

# Final review — ownership, migration, rollback, locking, layout

Worktree: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-bundle`  
Branch: `implementation-bundle`  
HEAD: `910c3daf04124c91afe4c0f01a09c0442658ead5`  
Staged files: none  
Lane: ownership, migration, rollback, locking, layout correctness  

**Verdict: not PASS.** One rollback regression from the remigrate fix. First install/uninstall cycle is correct; the documented reinstall path is not.

## Correct

**Config writes and lock.** The only `config.toml` writer is `config_patch.commit` (`src/config_patch.py:208-228`): baseline-aware `herdr config check`, then `ctx.atomic_write`. Event/tint/sidebar/keybind/view/migrate/uninstall paths take `ctx.Lock`. Layouts do too (`src/layout_actions.py:179-183`). `cmd_install` sequences migrate then sidebar without nesting locks. `cmd_intensity` / `cmd_marker` / `cmd_announce` write `settings.json` under the lock (`src/main.py:663-704`).

**Owned rows vs `rows_by_agent`.** `install_sidebar` only writes `ui.sidebar.spaces.rows` and `ui.sidebar.agents.rows` (`src/config_patch.py:411-470`). Agents get the 15-token template; spaces get `$sd_*`. Existing `rows_by_agent` entries are never created or rewritten (`tests/test_bundle.py` `test_rows_by_agent_never_created_or_dotted`). Doctor warns that `rows_by_agent` fully replaces `rows` (`src/main.py:1018-1023`).

**Stale Chromatic backups are not applied.** `import_legacy` records `sidebar_backup` / `theme_backup` / `last_written` as ignored and never copies them into this plugin’s restore fields (`src/migrate.py:139-147`, `211-213`). First migrate snapshots live `ui.sidebar.spaces.rows` and `ui.sidebar.agents.rows`. Identity conflicts raise without `--force`. Chromatic files stay on disk. Covered by `tests/test_bundle.py` `TestMigration`.

**First-cycle rollback and prior review fixes.** Restore skips `doc.set` when parsed values already match (`src/config_patch.py:271-276`). Uninstall/remove pass `tidy_tables=SIDEBAR_TIDY_TABLES` (`src/main.py:555-556`, `1136-1137`). Idempotent sidebar install records `last_written` (`src/main.py:515-517`). `install --dry-run` only runs migrate dry-run (`src/main.py:1199-1203`). Occupied picker keys are refused (`src/config_patch.py:521-524`). Install keeps migrated `view_mode`. Re-migrate does not replace a still-set `ownership_baseline` while `sidebar_backup` is also still set.

**Layouts.** `src/layouts.py` matches `herdr-pane-layouts` `0ef0a8d5` (presets, insertion plan, `same` ε=0.01, Python 3.6 `/ float(len(ids))`). `reshape` still uses a staging tab, recovery, zoomed refusal, 2% resize, single-pane no-op. Herdr calls go through `rpc.py`. Mocked two-pane equalize exercises `pane.move` new-tab then insert (`tests/test_bundle.py` `test_equalize_moves_through_staging_tab`). Stderr prefix is `window-manager:`.

**Checks run (this review).** `/usr/bin/python3 -m py_compile src/*.py tests/*.py` exit 0. `/usr/bin/python3 -m unittest discover -s tests -t tests` — **156 tests, OK, 0.318s**. `git diff --cached` empty. Isolated reproduction of the rollback bug below (temp `HERDR_*` only).

## Blocker

**Stale `ownership_baseline` is reattached as `sidebar_backup` after uninstall.**

`cmd_uninstall` clears `sidebar_backup` and `last_written` but not `ownership_baseline`:

```1164:1172:src/main.py
        st["theme_backup"] = None
        st["sidebar_backup"] = None
        st["sidebar_installed"] = False
        st["tint_enabled"] = False
        st["last_tint"] = None
        st["last_written"] = {}
        state_mod.save(st)
```

`snapshot_ownership_baseline` then fills an empty `sidebar_backup` from the surviving baseline, not from live config:

```101:113:src/migrate.py
def snapshot_ownership_baseline(st, doc=None):
    ...
    if st.get("ownership_baseline") is None:
        st["ownership_baseline"] = captured
    if st.get("sidebar_backup") is None:
        st["sidebar_backup"] = st["ownership_baseline"]
    return st["ownership_baseline"]
```

`cmd_install` always migrates first (`src/main.py:1204-1207`). After that, `cmd_sidebar_install` will not replace `sidebar_backup` (`src/main.py:511-512`). Uninstall #2 therefore restores snapshot #1.

Reproduced in an isolated temp tree (not live HOME):

1. Config agents row A = `[["state_icon","workspace","tab"],["agent"]]`.
2. `migrate.import_legacy(st)` → `sidebar_backup` and `ownership_baseline` are A.
3. Simulate uninstall: `sidebar_backup = None`, `last_written = {}`, leave `ownership_baseline`.
4. Change config agents row to B = `[["state_icon", {token="$elapsed", dim=true}]]`.
5. `migrate.import_legacy(st)` again → `sidebar_backup` is still A, not B.

The remigrate test only keeps both fields set (`tests/test_bundle.py:215-233`). There is no uninstall-then-reinstall coverage. This is a regression of the “do not overwrite `ownership_baseline` once set” fix: that is right while the plugin still owns the file, wrong after uninstall.

Fix (not applied here): on uninstall also set `ownership_baseline = None`, and/or assign `sidebar_backup = captured` (live rows) when it is empty, never `st["ownership_baseline"]`.

## Note

- Layout recovery and process preservation are still unproven against a real Herdr server. The new mock covers happy-path two-pane equalize only.
- Python 3.6+ is claimed; this run used `/usr/bin/python3` (3.9.6 in prior reviews). New modules have no walrus/f-strings/builtin generics.
- After cutover, a still-linked Chromatic or `layouts` plugin can still race `config.toml` / reshape. Documented in `docs/cutover.md`.
- Remigrate without `--force` overwrites origin when colours match (`src/migrate.py:152-160` only compares colour). First migrate on empty state is fine.
- `cmd_install` still runs keybind/view/reconcile if sidebar commit fails (`src/main.py:1207-1212`). Pre-existing Chromatic sequencing.
- Copied `legacy-layouts-settings.json` is still unread (plan: copy-if-present).

## Residual risks

- Live reshape/recovery and process preservation.
- No Python 3.6 runtime.
- Dual plugin writers until cutover unlinks Chromatic and `layouts`.
- Title/elapsed/tier still depend on external publishers.