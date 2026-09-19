# Dev log

Status: Step 1 complete; step 2 Linux proofs in, blocked on macOS

## Planning checkpoint

The user approved all 27 facts and their verification choices through Plannotator. The user then approved `plan.md` through the plan gate.

Only the goal package was created. No application code, live configuration, state, registration, or dependency installation changed. No implementation or runtime verification has run.

The package structure, fact metadata, plan coverage, and local links were checked during setup. Tool-specific review provenance is retained in `facts-result.json` and `plan-review.txt`.

Next action after an explicit goal launch: read the contract, establish the isolated implementation worktree, and begin step 1. Append future progress and evidence below this checkpoint.

## 2026-09-19 step 1 inventory

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529` from `13419c7` (`origin/refactor/typescript-port`). This cloud checkout is isolated and is not live-linked. User settings, state, and the default Herdr session were not touched.

Contract files were re-read. `intent.md`, `facts.md`, `facts.meta.json`, and `plan.md` were left unchanged. Frozen Python `src/`, `tests/`, and `herdr-plugin.toml` match `8b7bb76cf88e9be0452f126209aa58f84be0b0ed` (`git diff 8b7bb76 -- src tests herdr-plugin.toml` empty). Manifest version is `0.5.0`. `AGENTS.md` still says `0.1.0`; the freeze wins.

Changed files:

- `ai-artifacts/goals/mosaic-typescript-port/parity.md` — 50 commands, 10 aliases, 30 actions, 10 events, 4 panes, startup reconcile, safety guarantees, capability rows. All status `pending`.
- `scripts/check-parity-inventory.py` — coverage check; does not import plugin modules.
- `ai-artifacts/goals/mosaic-typescript-port/evidence/README.md`

Validation: `python3 scripts/check-parity-inventory.py` → `parity inventory covers 105 frozen entrypoints` (exit 0).

Documented disagreements (preserve Python behavior): version string in `AGENTS.md`, `rows_by_agent` host capability vs Mosaic policy, optional settings keys, dual marker defaults, `ownership_baseline` vs backup restore, `action_renames` omitted from `default_state()`, Chromatic path env divergence, agent-row token listing, `install --dry-run` migrate-only quirk, missing Python PTY tests, untested layout recovery failure path.

Next: step 2 stack pins (Bun 1.4.2, TypeScript 7.0.2, Effect 4.0.0-rc.116, Oxlint 1.82.0, anti-slop `c44ef22`). Prove compile, isolation, lock, worker, terminal, and fake Herdr transport before feature porting.

## 2026-09-19 step 2 Linux runtime proofs

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated cloud checkout. Default Herdr session, user settings, and live registration were not used. Herdr 0.9.0 was installed to `/tmp/mosaic-tools/herdr` for disposable `tests/herdr` only.

Contract files left unchanged except append-only `dev-log.md`, `parity.md` evidence columns, and `evidence/step-2-linux.md`. Frozen Python still matches `8b7bb76`.

Stack: Bun 1.4.2, TypeScript 7.0.2, Effect 4.0.0-rc.116, Oxlint 1.82.0, anti-slop `c44ef22` with Bun `mock.module` coverage. Effect `AGENTS.md` was read. Production CLI is `src/cli.ts`; the Python manifest is unchanged until step 7.

File placement: `src/cli.ts`, `src/dispatch/`, `src/runtime/` (paths, flock FFI, lock, rpc, terminal, worker), `src/migrate/pending.ts`, tests under `tests/{cli,unit,runtime,artifact,herdr,support}`.

Validation (Linux x86_64):

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 20 pass
- `bun run test:runtime` 11 pass (flock contend/death/SIGINT, virtual and wall-clock timeout, PTY raw/input/resize/cancel/restore, worker race exit 0)
- `bun run test:artifact` pass
- `bun run test:herdr` pass against Herdr 0.9.0 protocol 22 on a disposable HOME
- `python3 scripts/check-parity-inventory.py` 105 entrypoints

Blocker: macOS flock, worker, PTY, artifact, and real-Herdr proofs are required by fact-09 / fact-20 and the step 2 gate. This environment cannot run them. Step 3 is not started.

Next: macOS runner or owner approval to proceed without that gate.

## 2026-09-19 step 3 Linux reversible sidebar

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated cloud checkout. Default Herdr session, user settings, and live registration were not used. macOS remains an open step-2 completion gate (fact-09 / fact-20). Step 2 is not marked complete.

Frozen Python still matches `8b7bb76`. Contract files left unchanged except append-only `dev-log.md`, `parity.md` evidence columns, and `evidence/step-3-linux.md`.

File placement: `src/config/toml-edit.ts`, `src/config/patch.ts`, `src/config/sidebar.ts`, `src/state/store.ts`, `src/spaces/palette.ts`, `src/runtime/plugin-log.ts`, fake `herdr config check` in `tests/support/fake-herdr-bin.ts` with PATH wrapper `installFakeHerdr`.

Validation (Linux x86_64):

- `bun run typecheck` pass
- `bun run lint` pass
- `bun run test` 95 pass (includes `--force` restore)
- `python3 scripts/check-parity-inventory.py` 105 entrypoints

Python `state.load()` reads TypeScript-written `sidebar_backup` present/value records. Repeat install is a no-op. Remove restores exact fixture bytes. User-edited owned keys skip without `--force` and restore with `--force`. `not_a_real_token` is rejected with live bytes unchanged. `legacy_unknown_key` in the baseline is tolerated. Pre-existing `rows_by_agent.claude` remains byte-stable.

Open in this slice: crash-injection for atomic writes; doctor `rows_by_agent` warning; 17th-token reject; real Herdr `config check` on every fixture (later disposable-HOME).

Next: step 4 full install, identity, migration, doctor, uninstall. Do not add success-returning stubs. macOS proofs remain required for completion.

## 2026-09-19 step 4 identity and label core

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated cloud checkout. Default session unused. macOS remains an open step-2 gate. Step 2 and step 4 are not complete.

Ported `src/spaces/identity.ts` (allocate, ensureAll, slot/hex resolve, close pairs) and `src/spaces/labels.ts` with settings load. `setIdentity` / `identityOf` live on `src/state/store.ts`. CLI apply-identity, metadata publish, migrate, doctor, and uninstall are not wired yet.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 114 pass, parity inventory 105.

Next: metadata publish and apply-identity/auto-assign through production CLI, then migrate/keybinds/install/uninstall. No success-returning stubs.

## 2026-09-19 step 4 apply-identity CLI

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS remains an open step-2 gate.

Wired `apply-identity` / `set-color` through production CLI under the plugin lock. Invalid colours exit 1 with no state write and no Herdr calls. Valid colours save origin=manual and publish workspace slot tokens via `workspace.report_metadata`. Title publish (`agent-sidebar-title`) and `refresh.start` are not wired yet.

Validation: `bun run typecheck` pass, `bun run lint` pass, `bun run test` 117 pass.

Next: auto-assign, migrate, keybinds, install/uninstall. Still no success-returning stubs.

## 2026-09-19 step 4 auto-assign and migrate

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs remain unrun in this environment; the owner will verify them after the PR is open. Step 2 is not marked complete.

Wired `auto-assign` / `assign-colors` under the plugin lock. `--force` drops only the context/focused identity. Repeat assign prints `(all spaces already had identities)`.

Wired `migrate` under the plugin lock. Window Manager import is byte-exact, never overwrites existing Mosaic files (including with `--force`), and records `window-manager-import.json` so later Chromatic state cannot overlay. Chromatic import lists stale `sidebar_backup` / `theme_backup` / `last_written`, snapshots live ownership, and does not auto-enable tint. MigrationError prints a timestamped warn plus the raw message and exits 1.

Validation: `bun run typecheck` pass, `bun run lint` pass, `bun run test` 131 pass, parity inventory 105.

Next: keybinds, install (dry-run migrate-only), doctor, uninstall. Still no success-returning stubs.

## 2026-09-19 step 4 keybinds

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Wired picker, sort, idle, prune, pane-move, and promote keybind install/remove through the production CLI. Occupied keys and pre-existing sort bindings are not claimed. `# added by iurysza.mosaic` is stripped with the section on remove.

Validation: `bun run typecheck` pass, `bun run lint` pass, `bun run test` 137 pass.

Next: install (dry-run migrate-only), doctor, uninstall. Still no success-returning stubs.

## 2026-09-19 step 4 install, doctor, uninstall

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Wired `install` (dry-run is migrate-only; success is migrate → sidebar → six keybinds → action rename with save-before-commit → view(mode) → reconcile), `doctor` (always 0, warns every `rows_by_agent`), and `uninstall` (one lock, one commit, Mosaic backups only, title/elapsed clear, identities kept). Agent view scope/sort, view-clear, and reconcile view reinstall go through `src/agents/view.ts`. Tint apply and post-success `publish_once` / `refresh.start` are not wired.

File placement: `src/agents/view.ts`, `src/lifecycle/{install,uninstall,doctor,reconcile}.ts`, `src/spaces/theme.ts`, `src/config/action-renames.ts`.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 145 pass, parity inventory 105.

Next: tint/theme apply, title publish, refresh.start, events, TUI, layouts. Still no success-returning stubs.

## 2026-09-19 step 5 tint and presentation

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Wired `applyTint` (`applied`/`noop`/`conflict`/`skip`), theme backup of TINT_KEYS ∪ OVERLAY_KEYS, window title set/clear, `tint-enable`/`tint-disable`/`theme-restore`, `intensity`, `preview`, `marker`, `announce`, `repalette`, `list`, and `state`. Reconcile now reapplies tint when enabled. Duplicate focus is a noop (one reload). User-edited theme keys skip without `--force`. Semantic slots are not written. Restore is byte-exact on the users_real fixture.

File placement: `src/spaces/tint.ts`, `src/spaces/presentation.ts`, `tests/cli/tint.test.ts`, `tests/unit/theme.test.ts`.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 168 pass, parity inventory 105.

Next: title/elapsed publish and a real refresh worker loop before wiring `publish_once`/`startRefreshWorker` in `runCli`. Then events, TUI, layouts. Still no success-returning stubs.

## 2026-09-19 step 5 titles, elapsed, refresh loop

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Wired elapsed rendering (3-cell U+2800 pad, `now`/`Nm`/`Nh`/`Nd`/`99d`), `elapsed-publish`, and sidebar title+elapsed publish. Titles have no TTL; elapsed uses 45000. `$themed_model_tier` is never written. `runCli` calls `publishOnce` after successful install, reconcile, apply-identity, and repalette. The refresh worker loop publishes under the generation lock. `refresh.start` is not wired from `runCli` so CLI tests do not spawn detached 30-second workers.

File placement: `src/agents/elapsed.ts`, `src/agents/sidebar-publish.ts`, `src/runtime/worker.ts` loop, `src/cli.ts` post-success publish.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 177 pass, `bun run test:runtime` 11 pass, parity inventory 105.

Next: event dispatcher, then TUI and layouts. Wire `refresh.start` once CLI fixtures can own a short-lived worker. Still no success-returning stubs.

## 2026-09-19 step 5 event dispatcher and last-settled tracking

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Wired `event` through the production CLI. Last-settled tracking matches the frozen Python launch/completion rules. Focused uses live RPC, not the payload. Closed spaces keep identity. Detection initialises a clock once; released detects are ignored; close/exit drop occupancy. `workspaceIdOfPane` now splits on the first colon so pane republish finds the space. `refresh.start` is still not wired from `runCli`.

File placement: `src/agents/tracker.ts`, `src/agents/events.ts`, `tests/unit/tracker.test.ts`, `tests/cli/events.test.ts`.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 208 pass, parity inventory 105.

Next: agent triage (next-idle, prune), then TUI and layouts. Wire `refresh.start` once CLI fixtures can own a short-lived worker. Still no success-returning stubs.

## 2026-09-19 step 5 idle cycle and prune opener

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Wired `next-idle-agent` (newest first, wrap, skip focused, untracked last; cursor only after successful `agent.focus`) and `prune-stale-agents` (opens the prune popup with the pre-popup focused pane protected). `closeSelected` rechecks eligibility so a working agent is not closed. The prune TUI is not ported.

File placement: `src/agents/triage.ts`, `tests/unit/triage.test.ts`, `tests/cli/triage.test.ts`.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 219 pass, parity inventory 105.

Next: layouts, then picker/board/prune/pane-move TUI. Wire `refresh.start` once CLI fixtures can own a short-lived worker. Still no success-returning stubs.

## 2026-09-19 step 5 pane layouts

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Ported the pure layout core and the locked equalize/cycle/resize CLI. Equalize stages leftover panes through a `new_tab` then reinserts. A rejected reinsert recovers onto the original tab. Zoomed tabs fail before moves. Errors use the `mosaic:` prefix. `arrange-columns` and `next-layout` aliases are wired.

File placement: `src/panes/layouts.ts`, `src/panes/layout-actions.ts`, `tests/unit/layouts.test.ts`, `tests/cli/layout.test.ts`.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 242 pass, parity inventory 105.

Next: pane-move capture/promote, then picker/board/prune/pane-move TUI. Wire `refresh.start` once CLI fixtures can own a short-lived worker. Still no success-returning stubs.

## 2026-09-19 step 5 pane-move capture and promote

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Wired `move-pane` two-step capture and confirm-open, `promote-pane` without consuming a pending selection, and `pane-move` usage/env/TTY guards. Confirmed split moves right of the destination at ratio 0.5. Same-pane split is refused; same-pane new tab is allowed. The confirmation TUI is not ported.

File placement: `src/panes/pane-move.ts`, `tests/cli/pane-move.test.ts`.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 242 pass, parity inventory 105.

Next: picker/board/prune/pane-move TUI. Wire `refresh.start` once CLI fixtures can own a short-lived worker. Still no success-returning stubs.

## 2026-09-19 step 5 picker, board, prune, and pane-move TUIs

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Ported the four popups as pure key/render transitions plus a raw TTY loop. `set-identity` opens the picker popup. `q` cancels (picker prints `cancelled`). Custom hex is a prompt where `q` is a character. `board --once` dumps without a TTY. Prune columns match the Python layout. Pane-move cancel clears the pending selection under the plugin lock. Scripted PTY tests cover cancel, resize, and cursor restore.

File placement: `src/terminal/{keys,screen,session}.ts`, `src/spaces/picker.ts`, `src/agents/board.ts`, `src/agents/prune-ui.ts`, `src/panes/pane-move.ts`, `tests/support/pty-drive.py`.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 265 pass, `bun run test:runtime` 15 pass, parity inventory 105.

Next: wire `refresh.start` once CLI fixtures can own a short-lived worker. Then stress and package. Still no success-returning stubs.

## 2026-09-19 step 5 refresh.start from runCli

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

`runCli` now calls `startRefreshWorker` after a successful `publishOnce` on install, reconcile, apply-identity, repalette, and the refresh events. Start still requires `sidebar_installed` and a matching `plugin.list` registration. Isolated tests set `MOSAIC_TEST_ISOLATED` so the worker exits after one round.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 265 pass, `bun run test:runtime` 15 pass, parity inventory 105.

Next: stress integration boundaries, then package. Still no success-returning stubs.

## 2026-09-19 step 6 stress integration boundaries

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Extended the existing fake Herdr transport, CLI, and runtime suites. Faults sit at adapters: fragmented socket writes, leftover tmp files, SIGKILL, overlapping subprocesses, injected `pane.move` failures. `refreshWorkerArgs` omits the source path when the executable is the compiled binary.

Validation (Linux x86_64): `bun run typecheck` pass, `bun run lint` pass, `bun run test` 271 pass, `bun run test:runtime` 25 pass, parity inventory 105. Evidence: `evidence/step-6-stress.md`.

Next: package the exact candidate (`herdr-plugin.toml` off Python, benches, `completion.md`). Still no success-returning stubs.

## 2026-09-19 step 7 package the exact candidate

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default session unused. macOS native proofs will be run by the owner after the PR is open. Step 2 is not marked complete.

Production manifest, docs, CI, benches, and standalone now launch `dist/mosaic`. Compiled argv drops Bun's `/$bunfs/root/mosaic` placeholder. Frozen Python stays as a reference. `completion.md` records Linux evidence and the unexecuted cutover.

Validation (Linux x86_64, `77d5f9a`): typecheck pass, lint pass, `bun run test` 280, `bun run test:runtime` 25, `bun run test:artifact` 4, parity 105, Python unittest 280, Herdr 0.9.0 transport pass, `scripts/check-standalone.py` passed. Evidence: `evidence/step-7-package.md`.

Next: owner-run macOS native proofs after the PR. Live cutover remains out of scope. Still no success-returning stubs.



