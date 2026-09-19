# Dev log

Status: Step 1 complete; step 2 in progress

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
