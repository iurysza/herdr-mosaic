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

