## Review
- Correct: the post-fix bundle matches the approved plan. Prior review notes are fixed in code and tests. 156 tests passed on isolated paths.
- Blocker: none
- Note: live reshape recovery and Python 3.6 runtime remain unproven. No remaining fix worth doing now.

Verdict: **PASS**

Worktree: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-bundle`  
Branch: `implementation-bundle`  
HEAD: `910c3daf04124c91afe4c0f01a09c0442658ead5`  
Staged files: none  
Live Herdr / default HOME / other repos: not mutated

---

### Correct

**Prior notes are actually fixed.** Initial reviews had no blockers. The fix pass closed the lifecycle notes:

| Prior note | Evidence now |
|---|---|
| Restore always `doc.set`s / empty sidebar tables | `src/config_patch.py:255-279` skips `doc.set` when parsed values match; uninstall/remove pass `SIDEBAR_TIDY_TABLES`. `tests/test_bundle.py:131-144` keeps multiline live agents row |
| Idempotent install skipped `last_written` | `src/main.py:516-517` and `527`. `tests/test_bundle.py:544-555` |
| `install --dry-run` mutated | `src/main.py:1198-1202` returns migrate only. `tests/test_bundle.py:557-577` |
| Picker bind not “if free” | `src/config_patch.py:499-506`. `tests/test_bundle.py:146-166` |
| `install` forced view `all` | `src/main.py:1207-1212`. `tests/test_bundle.py:579-597` |
| Re-migrate overwrote `ownership_baseline` | `src/migrate.py:101-111`. `tests/test_bundle.py:216-237` |
| Doctor silent on `rows_by_agent` | `src/main.py:1018-1023`. `tests/test_bundle.py:599-630` |
| Label side-effect skipped publish | `src/main.py:36-43`. `tests/test_bundle.py:350-386` |
| settings.json writes outside lock | `src/main.py:663-704` (`cmd_intensity` / `cmd_marker` / `cmd_announce`) |
| `pane-layouts:` stderr | `src/layout_actions.py:187`. `tests/test_bundle.py:520-541` |
| Multi-pane reshape untested | `tests/test_bundle.py:473-518` mocks staging-tab equalize `pane.move` |

**Plugin identity and interpreter.** `herdr-plugin.toml:1` is `id = "iurysza.window-manager"`. No `[[build]]`. Every `command =` uses `/usr/bin/python3` and `$HERDR_PLUGIN_ROOT`. `src/ctx.py:16` matches. `tests/test_bundle.py` `TestManifest`.

**Owned sidebar split.** `src/config_patch.py:57-64` is 15 tokens: `state_icon`, `$elapsed`, 12 `$title_*`, `$themed_model_tier`. Isolated `herdr config check` after `install_sidebar` on `users_real`: `config: ok`; agents 15 tokens, no `$sd_*`; spaces have `$sd_*`. Live 15-token template also `config: ok`. `rows_by_agent` is never created or rewritten (`tests/test_plugin.py:553-568`, `tests/test_bundle.py:89-102`). `table_is_empty` (`src/toml_edit.py:492-506`) returns false when a nested `rows_by_agent` table exists, so uninstall tidy cannot drop it.

**Config writes and locking.** Only `config_patch.commit` (`src/config_patch.py:208-232`) writes `config.toml`, after baseline-aware `herdr config check`. Mutating commands take `ctx.Lock`. Layouts do too (`src/layout_actions.py:179-183`). `cmd_install` sequences migrate then sidebar without nesting locks.

**Migrate / uninstall.** Chromatic `sidebar_backup` / `theme_backup` / `last_written` are recorded as ignored (`src/migrate.py:139-147`) and never copied into this plugin’s restore fields. Uninstall restores `st["sidebar_backup"]` (`src/main.py:1122-1140`). `tests/test_bundle.py:239-263`.

**Layouts.** `src/layouts.py` is a 3.6 port of `herdr-pane-layouts` `0ef0a8d5` (`midpoint / float(len(ids))`, no walrus/generics). `src/layout_actions.py` keeps staging-tab reshape, recovery, zoomed refusal, `RESIZE_AMOUNT = 0.02`. Herdr calls go through `rpc.py`.

**Elapsed/tier stay external.** Template consumes `$elapsed` / `$title_*` / `$themed_model_tier`. Nothing in `src/` publishes them. Last-focus is absent (`README.md` known limitations).

**Python 3.6 claim vs this machine.** AST/text scan of `src/` and `tests/` found no walrus, `match`, builtin generics, `dataclasses`, `capture_output`, or `from __future__ import annotations`. No Python 3.6 binary is installed. Runtime used `/usr/bin/python3` 3.9.6.

**Tests this review.** `/usr/bin/python3 -m py_compile src/*.py tests/*.py` exit 0. `/usr/bin/python3 -m unittest discover -s tests -t tests` — **156 tests, OK, 0.339s**. Isolated `herdr config check` (herdr 0.8.2) on temp `HERDR_CONFIG_PATH` only. `git diff --cached` empty.

### Blocker

None.

### Note

1. Layout **recovery** after a failed reshape is still inspection-only. Equalize reshape is mocked; live `pane.move` / process preservation was not run (isolation rule).
2. Python 3.6+ is claimed; only 3.9.6 ran.
3. After cutover, a still-linked Chromatic or `layouts` plugin can still race `config.toml` / reshape. Documented in `docs/cutover.md`.
4. `has_agent_template` is still exact on `dim`. A live row that omits `dim = false` is replaced rather than treated as installed. Left as-is.
5. Copied `legacy-layouts-settings.json` is still unread (plan: copy-if-present).
6. `cmd_install` still continues to keybind/view/reconcile if sidebar install returns non-zero. Pre-existing composition; not introduced by this pass.

---