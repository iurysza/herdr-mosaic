# Implementation report — `iurysza.window-manager` bundle

## Worktree / branch / base

| | |
|---|---|
| Worktree | `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-bundle` |
| Branch | `implementation-bundle` |
| Requested branch | `implementation/bundle` (illegal while `implementation` exists; supervisor approved this name) |
| Base HEAD | `910c3daf04124c91afe4c0f01a09c0442658ead5` |
| Source checkout | `/Users/iurysouza/dev/personal/tools/herdr-window-manager` on `implementation`, dirty, **not modified** by this work |
| Commits | none |
| Staged files | none |

Worktree left in place for review. No push. No live plugin link/install/uninstall.

## What shipped

Single plugin `iurysza.window-manager` in this repository (not agents).

- Chromatic identity, picker, tint, grouped agent view, startup reconcile
- Spaces sidebar: `$sd_*` + `workspace` / `branch` / `git_status`
- Agents sidebar: `state_icon` + `$elapsed` + 12 `$title_*` + `$themed_model_tier` (15 tokens). Blanks kept. No `$sd_*` on agent rows
- Pane Layouts equalize / cycle / 2% resize, process-preserving reshape, under `ctx.Lock`
- Label→colour rules (version-1 JSON)
- Explicit `migrate`: copy Chromatic identities/settings and layouts settings; retain old files; snapshot live config as the new restore baseline; **never apply** Chromatic `sidebar_backup` / `theme_backup` / `last_written`

Consumes `herdr-agent-elapsed` and themed `$themed_model_tier`. Does not absorb those publishers. Last-focus deferred. No uv/typed rewrite. No agents/chezmoi integration.

## Changed files

Modified:

- `CLAUDE.md`, `LICENSE`, `README.md`, `herdr-plugin.toml`
- `src/config_patch.py`, `src/ctx.py`, `src/main.py`, `src/metadata.py`, `src/state.py`
- `tests/test_plugin.py`

Added:

- `AGENTS.md`
- `src/labels.py`, `src/layouts.py`, `src/layout_actions.py`, `src/migrate.py`
- `tests/test_bundle.py`, `tests/test_layouts.py`
- `docs/provenance.md`, `docs/cutover.md`
- `ai-artifacts/goals/plugin-bundle/plan.md`
- `ai-artifacts/goals/plugin-bundle/dev-log.md`
- `ai-artifacts/goals/plugin-bundle/implementation-report.md`

## Tests

Baseline (source tree, before edits): 118 tests, OK, 0.253s.

Worktree after implementation:

```
cd /Users/iurysouza/dev/personal/worktrees/herdr-window-manager-bundle
python3 -m unittest discover -s tests -t tests
```

**146 tests, OK, 0.289s, exit 0.**

`/usr/bin/python3 -m py_compile src/*.py tests/*.py` — exit 0.

Added/updated tests:

- `tests/test_plugin.py` — agent template vs space dots; `rows_by_agent` preservation; isolated env so tests cannot touch live Herdr paths
- `tests/test_layouts.py` — ported layout tree/preset/insertion tests
- `tests/test_bundle.py` — 15-token cap, 15+12 dots rejected, blank titles kept, idempotence, exact rollback, real `herdr config check` on the live agent template, stale Chromatic backup refusal, identity conflicts, label rules, layout lock/dispatch, manifest id and `/usr/bin/python3` paths

## Behaviour exercised

- Sidebar install writes dots only on spaces; replaces agents `rows` with the 15-token template; leaves `rows_by_agent` byte-identical; never creates new `rows_by_agent`
- Combining space dots with the title row fails with a named 16-token-limit error
- Uninstall restore uses **this** plugin’s snapshot, not Chromatic’s “agents.rows was absent” backup
- Migrate copies identities, copies settings/label rules when missing, leaves Chromatic state on disk, ignores stale backups
- Label rules assign `origin=label`; manual picker colours are not overwritten
- Layout `run` takes `ctx.Lock`; resize amount 0.02; zoomed tabs fail; single-pane equalize is a no-op
- Manifest id `iurysza.window-manager`; every command uses `/usr/bin/python3` and `$HERDR_PLUGIN_ROOT`; no `[[build]]`

## Not exercised (isolation)

Live Herdr mutations were **not** run. `herdr --session` shares the default `config.toml`. A disposable HOME + config + socket + plugin registry with no fallback to live defaults was not available without risking the current session. No user-space pane creation or focus changes.

Layout reshape/recovery against a real server is therefore unproven here (covered by unit tests and the upstream layouts e2e, which was not re-run live).

## Outstanding limitations

- Cutover is documented in `docs/cutover.md`, not performed
- Chezmoi still owns Herdr sidebar rows until a later dotfiles change
- Chromatic GitHub pin is still the live plugin
- Default picker key `prefix+i` collides with Command Palette on this machine
- Two Herdr sessions still fight over tint
- Title/elapsed still depend on the external elapsed unit; this plugin does not fill blanks

## Safeguards held

- Source checkout status unchanged: `D CLAUDE.md`, untracked `.pi/`, `AGENTS.md`, `ai-artifacts/`, `probes/`
- No stash/reset/stage/commit/push
- No writes to agents, dotfiles, `~/.config`, live plugins, services, or panes
- No Chromatic live install/uninstall

## Review-fix pass (post Grok reviews)

Reviews had **no blockers**. Applied in-scope lifecycle, correctness, test, and docs fixes. Ignored live-server smoke, Python 3.6 runtime, and product expansion.

### Code

- Restore skips `doc.set` when parsed values already match; uninstall/remove tidies empty `ui.sidebar.spaces` / `agents` tables
- Idempotent sidebar install records `last_written` for owned keys
- `install --dry-run` only runs migrate dry-run
- Picker bind refuses a key already used by another command
- `install` keeps migrated `view_mode` (`current` or `all`)
- Re-migrate does not overwrite `ownership_baseline` / `sidebar_backup` once set
- Doctor warns that `rows_by_agent` fully replaces `rows`
- Label apply side-effects publish every newly labelled workspace
- `cmd_intensity` / `cmd_marker` / `cmd_announce` write `settings.json` under `ctx.Lock`
- Layout stderr prefix is `window-manager:`

### Docs

- README: `install --dry-run` is migrate-only; install keeps migrated `view_mode`
- `docs/cutover.md`: unlink the `layouts` plugin so two reshapers cannot race

### Tests after this pass

```
/usr/bin/python3 -m py_compile src/*.py tests/*.py   # exit 0 (Python 3.9.6)
/usr/bin/python3 -m unittest discover -s tests -t tests
```

**156 tests, OK, 0.337s, exit 0.** Interpreter 3.9.6. Tests isolate `HERDR_*`; no live HOME/config/socket writes from this suite. Nothing staged.

New coverage: multiline restore formatting, occupied `prefix+i`, remigrate baseline stability, label side-effect publish, staging-tab equalize reshape (mocked `pane.move`), layout error prefix, last_written on idempotent install, `install --dry-run`, migrated `view_mode`, doctor `rows_by_agent` warning.

### Finding disposition

| Finding | Disposition |
|---|---|
| Restore flattens live 15-token row / empty sidebar tables | Fixed |
| Idempotent install skips `last_written` | Fixed |
| `install --dry-run` still mutates | Fixed |
| Picker key not “if free” | Fixed |
| `install` forces view `all` | Fixed (keep migrated mode) |
| Re-migrate overwrites `ownership_baseline` | Fixed |
| `rows_by_agent` hides title row; doctor silent | Doctor warns; still never rewrites |
| Layout reshape unit-tested only | Added mocked staging-tab equalize; no live server |
| Two Chromatic+WM writers / two locks | Unchanged; cutover risk |
| Cutover did not unlink `layouts` | Documented |
| `pane-layouts:` stderr | Fixed |
| Label side-effect skips publish | Fixed |
| settings.json writes outside lock | Fixed for intensity/marker/announce |
| `has_agent_template` exact on `dim` | Left as-is |
| Copied `legacy-layouts-settings.json` unread | Left as-is (plan: copy-if-present) |
| No Python 3.6 runtime / live smoke | Residual |

### Residual risks

- Layout recovery and process preservation still unproven against a real Herdr server
- Python 3.6+ is claimed; only 3.9.6 ran
- After cutover, a still-linked Chromatic or `layouts` plugin can still race `config.toml` / reshape
- Title/elapsed/tier still depend on external publishers

## Blocker fix — stale baseline after uninstall

`cmd_uninstall` now clears `ownership_baseline` with `sidebar_backup` / `last_written`. `snapshot_ownership_baseline` still refuses to replace a set baseline while the plugin owns config, but an empty `sidebar_backup` is filled from **live** rows, not a leftover baseline.

Regression: `tests/test_bundle.py` `test_second_ownership_cycle_restores_current_preplugin_rows` (install → uninstall → external agents-row change → reinstall → uninstall; second restore is byte-equal to cycle B). Remigrate-while-owning still keeps KEEP.

`/usr/bin/python3 -m py_compile src/*.py tests/*.py` exit 0. `/usr/bin/python3 -m unittest discover -s tests -t tests` — **157 tests, OK, 0.371s**, exit 0. Nothing staged. No live Herdr / other-repo edits.
