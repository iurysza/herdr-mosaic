# Mosaic TypeScript port — completion report

Candidate: `cursor/mosaic-typescript-port-1529`. Production `dist/mosaic` sha256 `2e692b2a02cad327ab426542aa477af72e361a8928bab61e3f4ee0581d67c035` after the Darwin unix-socket realpath fix. Frozen Python reference remains `8b7bb76` / manifest `0.5.0`. Live cutover was not executed.

## Implemented behavior

Production commands, startup, events, panes, and actions launch `$HERDR_PLUGIN_ROOT/dist/mosaic` through `/bin/sh -c exec`. The compiled binary has no Python runtime dependency. Frozen `src/*.py` stays in the tree as an isolated reference and rollback option.

The TypeScript CLI preserves the reference lock, surgical TOML, byte-exact restore, Window Manager import, Chromatic stale-backup refusal, `rows_by_agent` non-rewrite, `$themed_model_tier` non-ownership, title/elapsed TTL contract, one refresh worker per socket generation, prune confirmation, and layout recovery.

## Inventory

`python3 scripts/check-parity-inventory.py` covers 105 frozen entrypoints. Every inventory row is `passed`.
No unexplained Python/TypeScript behavior differences were left unmarked. Shared CLI cases in `tests/cli/differential.test.ts` compare help, unknown-command, plugin-id errors, sidebar-install config bytes, install `--dry-run`, doctor exit 0, tint enable/disable restore, and install/uninstall byte restore in separate sandboxes. Every command and alias keeps the same plugin-id and pending-import guards. `rewriteArgv` keeps extra argv for every alias (`tests/unit/catalog.test.ts`). Every catalog command has a dispatch branch, so `UnimplementedCommand` cannot hide a missing entry. Python uninstall restores a TypeScript-installed fixture, and TypeScript uninstall restores a Python-installed fixture. Log JSON spacing is a documented incidental difference.

## Automated results

Linux x86_64 and GitHub Actions `macos-latest` (run 35470501982 on `ee0b54b`):

| Check | Linux | macOS |
| --- | --- | --- |
| `bun run typecheck` / `lint` | pass | pass |
| `bun run test` | 299 pass | 299 pass |
| `bun run test:runtime` | 25 pass | pass |
| `bun run test:artifact` | 4 pass | pass |
| `bun run test:herdr` | pass on Herdr 0.9.0 | pass on Herdr 0.9.0 |
| `bun run test:parity` | 105 entrypoints | 105 entrypoints |
| Python unittest | 280 pass | 280 pass |
| `scripts/check-standalone.py` | passed; receipt in `evidence/step-7-standalone-receipt.json` | passed |
| GitHub Actions Verify | success | success |

Evidence: `evidence/step-7-package.md`, `evidence/step-7-macos.md`, `evidence/step-7-bench.json`, plus earlier slice files under `evidence/`.

## Fact evidence

| Fact | Evidence | Status |
| --- | --- | --- |
| `fact-01` | `herdr-plugin.toml` launches `dist/mosaic`; no `python3` runtime commands | proven |
| `fact-02` | `package.json` pins; `bun run typecheck` / `lint`; `tests/unit/lint-policy.test.ts` | proven |
| `fact-03` | frozen `8b7bb76`; catalog, alias, guard, and CLI tests; `tests/test_public_api.py` | proven |
| `fact-04` | `parity.md` 105 rows passed; `python3 scripts/check-parity-inventory.py` | proven |
| `fact-05` | `tests/unit/config-patch.test.ts`; `tests/cli/sidebar.test.ts` | proven |
| `fact-06` | `tests/cli/lifecycle.test.ts`; `tests/cli/keybind.test.ts` | proven |
| `fact-07` | `tests/cli/migrate.test.ts` | proven |
| `fact-08` | `tests/unit/state.test.ts`; mixed-runtime uninstall; Python uninstall on Herdr 0.9.0 | proven |
| `fact-09` | `tests/runtime/lock.test.ts` on Linux and GitHub Actions `macos-latest` | proven |
| `fact-10` | sidebar, elapsed, events, config-patch tests | proven |
| `fact-11` | `tests/runtime/worker.test.ts`; standalone restart on Linux and macOS | proven |
| `fact-12` | `tests/cli/triage.test.ts`; `tests/runtime/tui.test.ts` | proven |
| `fact-13` | `tests/cli/layout.test.ts`; `tests/cli/pane-move.test.ts` | proven |
| `fact-14` | `bun run test` without Herdr | proven |
| `fact-15` | `tests/unit/isolation.test.ts`; isolate-preload | proven |
| `fact-16` | `tests/unit/rpc.test.ts`; no-module-mocking lint | proven |
| `fact-17` | `tests/cli/differential.test.ts` | proven |
| `fact-18` | `tests/runtime/tui.test.ts` on Linux and GitHub Actions `macos-latest` | proven |
| `fact-19` | `tests/artifact/compile.test.ts` on Linux and GitHub Actions `macos-latest` | proven |
| `fact-20` | `tests/herdr/*` and `scripts/check-standalone.py` on Linux and macOS Herdr 0.9.0 | proven |
| `fact-21` | `dev-log.md` step 1→7 | proven |
| `fact-22` | command-thin CLI; Effect at lock/RPC/TTY/worker | proven by review |
| `fact-23` | continuous execution in `dev-log.md` | proven |
| `fact-24` | append-only `dev-log.md` and `evidence/` | proven |
| `fact-25` | isolated checkout; no live cutover | proven |
| `fact-26` | `evidence/step-7-bench.json` (Linux `/proc` RSS/CPU; size unchanged after Darwin socket fix) | proven |
| `fact-27` | inventory passed; Linux and macOS Verify on `ee0b54b` | proven |

## Manual review

Architecture stays command-thin with Effect at I/O boundaries (lock, RPC, TTY, worker). Anti-slop and the no-module-mocking lint fixtures remain enabled. Public docs still describe the product, not the migration diary. Licence notices were not removed.

macOS native lock, TTY, compiled-min-PATH, Herdr, and standalone proofs ran on GitHub Actions `macos-latest` for `ee0b54b` (run 35470501982).

## Performance

Eight isolated samples, `PATH=/usr/bin:/bin` for the compiled binary. Medians: Python `--help` 35.8 ms, compiled `--help` 33.7 ms, bun-source `--help` 96.2 ms. Malformed-event medians: Python 51.7 ms, compiled 33.8 ms. Event times vary with host load.

Refresh-worker after the first one-pane heartbeat (CLK_TCK=100): Python 21_260 KB RSS, 5.9 ms round, 0.03 s user CPU; compiled 44_188 KB RSS, 4.3 ms round, 0.03 s user + 0.01 s system CPU. Package size: Python sources 226_695 bytes; compiled `dist/mosaic` 81_823_200 bytes because Bun embeds its runtime. Standalone refresh rounds were 0.3–0.4 s for one pane. TypeScript is not required to outperform Python.

## Remaining non-blocking risks

- The compiled binary and worker RSS are larger than Python because Bun embeds its runtime. Round CPU and wall-time stay in the same range. Worker RSS/CPU benches stay Linux-only (`/proc`).
- Two named Herdr sessions still share `config.toml`; `doctor` warns. That is unchanged reference behavior.
- Source `bun` without `--no-env-file` still loads cwd `bunfig.toml`. Production launch is the compiled binary, which does not.

## Cutover and rollback (not executed)

Cutover, when separately approved:

1. Back up the live `config.toml`.
2. Run Mosaic `uninstall` from the currently registered checkout.
3. Build `dist/mosaic` (`bun run build`) in the TypeScript checkout.
4. Register that checkout as `iurysza.mosaic` and invoke `install`.
5. Confirm `doctor`, sidebar titles, elapsed clocks, and one layout action in an isolated session before pointing at the default session.

Rollback:

1. Run TypeScript `uninstall`.
2. Restore the frozen Python checkout at `8b7bb76`.
3. Register it and invoke `install`. TypeScript-written `state.json` and restore records remain readable by that Python (`tests/unit/state.test.ts`). Python `sidebar-remove` restored TypeScript-installed `users_real` config bytes in `tests/cli/sidebar.test.ts`. Python `uninstall` restored a TypeScript-installed fixture in FakeHerdr sandboxes and on a disposable Herdr 0.9.0 server.
4. Keep Chromatic/Window Manager source directories; do not apply Chromatic `sidebar_backup` / `theme_backup` / `last_written`.

Do not run install, doctor, or uninstall against the default session until cutover is approved.
