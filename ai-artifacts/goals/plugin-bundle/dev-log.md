# Dev log — plugin bundle

## 2026-09-07 — Worktree

- Source checkout left dirty and untouched (`CLAUDE.md` deleted, untracked `AGENTS.md` / `ai-artifacts/` / `probes/` / `.pi/`).
- Requested branch `implementation/bundle` cannot be created while `implementation` exists.
- Supervisor approved `implementation-bundle`.
- Worktree: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-bundle` at `910c3daf`, untracked copy of source `AGENTS.md`.
- Baseline: `python3 -m unittest discover -s tests -t tests` — 118 tests, OK, 0.253s (run in source tree before worktree edits).

## 2026-09-07 — Implementation start

- Inspected Chromatic modules, Pane Layouts `0ef0a8d5`, live sidebar templates (read-only), label manifest format, and superseded audit notes.
- Layouts source uses Python 3.10 syntax; bundle will port the algorithm to 3.6.
- No live Chromatic install/uninstall; no agents/dotfiles/config writes.

## 2026-09-07 — Implementation complete

- Plugin id `iurysza.window-manager`. Spaces keep `$sd_*`. Agents get 15-token elapsed/title/tier row. `rows_by_agent` preserved. Layouts dispatched under `ctx.Lock`. Migrate copies identities and refuses Chromatic config backups.
- Validation in worktree: `python3 -m unittest discover -s tests -t tests` — 146 tests, OK, 0.289s. `/usr/bin/python3 -m py_compile src/*.py tests/*.py` — ok.
- Real `herdr config check` exercised by existing fixture tests plus `test_live_template_validates`.
- Isolated live Herdr session **not** run: named `--session` shares live `config.toml`; a safe disposable HOME/config/socket/registry was not available without fallback to live defaults.
- No commits, no staged files, source checkout unchanged, worktree left for review.

## 2026-09-07 — Review-fix pass

- Read Grok `review-correctness.md` and `review-validation.md`. No blockers. Reproduced lifecycle notes in code (`cmd_install` forwarding `--dry-run`, `last_written` only on changes, `install_keybind` command-only skip, `cmd_view(["all"])`, `snapshot_ownership_baseline` always replacing, restore always `doc.set`, doctor `preserved` for `rows_by_agent`, `_ensure_identity` not publishing other labelled spaces, `pane-layouts:` stderr, settings writes outside lock).
- Fixed those in `src/config_patch.py`, `src/main.py`, `src/migrate.py`, `src/layout_actions.py`; docs in README and `docs/cutover.md`; tests in `tests/test_bundle.py` and `tests/test_plugin.py`.
- Did not rewrite `rows_by_agent`, did not run live Herdr mutations, did not commit/stage/push.
- Validation: `/usr/bin/python3 -m py_compile src/*.py tests/*.py` exit 0. `/usr/bin/python3 -m unittest discover -s tests -t tests` — **156 tests, OK, 0.337s**, exit 0.
- `git diff --cached` empty. Source checkout `/Users/iurysouza/dev/personal/tools/herdr-window-manager` still `D CLAUDE.md` + untracked `.pi/` `AGENTS.md` `ai-artifacts/` `probes/` only. `herdr-pane-layouts` still has a pre-existing dirty `README.md` (not edited here).

## 2026-09-07 — Uninstall baseline blocker

- Final correctness review: uninstall left `ownership_baseline`; next migrate copied it into empty `sidebar_backup`, so uninstall #2 restored cycle-1 rows.
- Fix: `cmd_uninstall` sets `ownership_baseline = None`. `snapshot_ownership_baseline` assigns empty `sidebar_backup` from live `captured` rows, not leftover baseline. Remigrate while both fields are set still does not replace them.
- Regression `test_second_ownership_cycle_restores_current_preplugin_rows` plus existing remigrate KEEP test.
- `/usr/bin/python3 -m py_compile src/*.py tests/*.py` exit 0. Full suite **157 tests, OK, 0.371s**, exit 0. No stage/commit/push; no live Herdr.
