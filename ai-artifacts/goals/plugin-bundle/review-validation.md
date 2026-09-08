## Review
- **Correct:** The worktree matches the approved bundle: plugin id `iurysza.window-manager`, split sidebar templates, migrate that refuses Chromatic backups, layouts under `ctx.Lock`, and 146 tests passing on isolated paths.
- **Blocker:** none
- **Note:** Multi-pane reshape/recovery is untested here; live Herdr smoke was skipped; no Python 3.6 runtime.

Evidence and the acceptance report follow. The runtime should persist this as `ai-artifacts/goals/plugin-bundle/review-validation.md`.

---

# Review validation — `iurysza.window-manager` bundle

Worktree: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-bundle`  
Branch: `implementation-bundle`  
HEAD: `910c3daf04124c91afe4c0f01a09c0442658ead5`  
Staged files: none  
Live Herdr / default HOME / other repos: not mutated

**Verdict: approve.** No blockers. Implementation matches the approved plan. Automated checks passed on isolated paths.

## Review
- Correct: what is already good, with evidence
- Blocker: none
- Note: coverage and residual live-runtime gaps below

### Correct

**Plugin identity and dispatch.** `herdr-plugin.toml:1` is `id = "iurysza.window-manager"`. There is no `[[build]]`. Every `command =` uses `/usr/bin/python3` and `$HERDR_PLUGIN_ROOT` (`tests/test_bundle.py` `TestManifest`). `src/ctx.py:16` `PLUGIN_ID` matches. `src/main.py` maps `migrate`, `layout`, `install` (migrate then sidebar/keybind/view/reconcile), and the Chromatic commands. Layout actions in the manifest (`equalize`, `cycle`, `resize-*`) call `main.py layout …`, which delegates to `layout_actions.run`.

**Sidebar split matches the contract.** `src/config_patch.py:57-64` owns a 15-token agents row: `state_icon`, `$elapsed`, 12 `$title_*`, `$themed_model_tier`. No `$sd_*` on agents. Spaces still get `insert_tokens(..., dot_tokens())`. `install_sidebar` (`src/config_patch.py:408-455`) only writes `ui.sidebar.spaces.rows` and `ui.sidebar.agents.rows`. `rows_by_agent` is listed for doctor/tests and never created or rewritten. Mixing dots with the title row raises a named 16-token error (`refuse_agent_dots`, `src/config_patch.py:375-385`).

**Config writes stay on the safe path.** The only `config.toml` writer is `config_patch.commit` (`src/config_patch.py:208-232`): baseline-aware `herdr config check`, then `ctx.atomic_write`. Migrate copies plugin state/settings only and snapshots live rows as `ownership_baseline` / `sidebar_backup` (`src/migrate.py:101-111`, `151-157`). Chromatic `sidebar_backup` / `theme_backup` / `last_written` are recorded as ignored, not applied.

**Layouts match the existing plugin, with the planned seams.** `src/layouts.py` is a 3.6 port of `herdr-pane-layouts` `0ef0a8d5` (`balanced` / `tiled` / `same` / `insertion_plan` / `presets`). `tests/test_layouts.py` matches upstream `test/test_layouts.py`. `src/layout_actions.py` keeps staging-tab reshape, recovery, zoomed-tab refusal, 2% resize (`RESIZE_AMOUNT = 0.02`), and equalize/cycle target selection. Herdr calls go through `rpc.py` (id-matched socket reads). `run()` takes `ctx.Lock` (`src/layout_actions.py:180-187`), not the old `{socket}.layout.lock`. Resize also accepts pane ids from invocation context, which is stricter-compatible with plugin actions.

**Labels and metadata re-id.** `src/labels.py` applies version-1 JSON unless `origin == "manual"`. `src/metadata.py` `SOURCE = ctx.PLUGIN_ID`. `state.py` keeps `origin` `label` through palette migration. Elapsed/title/tier publishers are not imported (`docs/provenance.md`).

**Tests and isolation.** `tests/test_plugin.py` `Base.setUp` redirects state, config, socket, legacy Chromatic/layouts dirs, and `HERDR_CONFIG_PATH` into a temp tree before imports. New coverage in `tests/test_bundle.py`: 15-token cap, 15+12 rejection, live-template idempotence, blank titles kept, `rows_by_agent` byte-identical, exact rollback, real `herdr config check` after install, stale-backup refusal, identity conflicts, `--force`, dry-run, label rules, lock/dispatch, zoomed fail, single-pane equalize no-op, manifest interpreter paths.

**Docs / user-visible behaviour.** README, AGENTS.md, `docs/cutover.md`, and `docs/provenance.md` describe owned rows, consume-not-absorb tokens, no Chromatic live uninstall, prefix+i collision, and isolation rules. Doctor flags agent `$sd_*` as bad (`src/main.py` agents-row branch).

**Checks run (this review).**

| Command | Result |
|---|---|
| `python3 -m unittest discover -s tests -t tests` | 146 tests, OK, 0.276s |
| `/usr/bin/python3 -m py_compile src/*.py tests/*.py` | OK (`/usr/bin/python3` is 3.9.6) |
| Isolated `HERDR_CONFIG_PATH=/tmp/…/live_agents.toml herdr config check` | `config: ok` (herdr 0.8.2) |
| Isolated `herdr config check` on users_real after `install_sidebar` + tint | `config: ok`; agents 15 tokens, no `$sd_*`; spaces have `$sd_*` |
| `git diff --cached` | empty |

No live default `~/.config/herdr/config.toml` was used as `HERDR_CONFIG_PATH` for those checks.

### Blocker

None.

### Note

1. **Missing coverage — multi-pane reshape.** `tests/test_bundle.py` `TestLayoutDispatch` covers lock, 0.02 resize, single-pane equalize no-op, zoomed failure, and `main.cmd_layout` dispatch. It does not drive `reshape()`’s `pane.move` new-tab / insertion / recovery sequence. Behaviour matches `herdr-pane-layouts/src/cli.py` by inspection, not by execution. Upstream e2e (`test/e2e_live.py`) was not re-run (would mutate a live session).

2. **No Python 3.6 interpreter on this machine.** Syntax scan of `src/` found no walrus, match, or builtin generics. Runtime was 3.9.6 only.

3. **Live isolated Herdr smoke skipped**, as the implementation report said. `layout.export` / `pane.move` / `pane.resize` against a server are unproven here.

4. **`docs/cutover.md` remaps `layouts.*` keys but does not unlink plugin `layouts`.** If both stay linked, two reshapers can run with different locks. Cutover is out of scope for this worktree; worth a later checklist line.

5. **`src/layout_actions.py` still prints `pane-layouts:` on stderr** while notifications say “Window Manager layouts failed”.

6. **Label assignment vs focus publish.** `_ensure_identity` (`src/main.py`) runs `labels.apply` on every workspace. If a rule first fires as a side-effect of another space’s focus, the matching space’s later focus sees `origin=label` already and may skip `publish_workspace` until `reconcile`. Install/startup reconcile covers the cutover path.

7. **`has_agent_template` is exact on token/fg/dim.** A live row that omits `dim = false` is replaced rather than treated as already installed. Replacement is still the owned template; comments on that array would be lost.

8. **Copied `legacy-layouts-settings.json` is never read.** Plan only required copy-if-present.

9. **`cmd_intensity` / `cmd_marker` / `cmd_announce` still write `settings.json` outside `ctx.Lock`.** Pre-existing Chromatic pattern, not introduced for config.toml.

## Residual risks

- Layout reshape/recovery and process preservation are unproven against a real Herdr server in this worktree.
- Python 3.6+ is claimed; only 3.9.6 ran.
- After cutover, a still-linked `layouts` plugin could race reshape.
- Title/elapsed/tier still depend on external publishers; this plugin does not fill blanks (in scope).