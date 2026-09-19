# Mosaic TypeScript port — completion report

Candidate: `cursor/mosaic-typescript-port-1529`. Production `dist/mosaic` is unchanged from `77d5f9a` (sha256 `2a55c5abae4bba0ce729bed3f22c15c88b04141f1dd7b8368a79fe9779549a05`). Frozen Python reference remains `8b7bb76` / manifest `0.5.0`. Later commits add tests and evidence only. Live cutover was not executed.

## Implemented behavior

Production commands, startup, events, panes, and actions launch `$HERDR_PLUGIN_ROOT/dist/mosaic` through `/bin/sh -c exec`. The compiled binary has no Python runtime dependency. Frozen `src/*.py` stays in the tree as an isolated reference and rollback option.

The TypeScript CLI preserves the reference lock, surgical TOML, byte-exact restore, Window Manager import, Chromatic stale-backup refusal, `rows_by_agent` non-rewrite, `$themed_model_tier` non-ownership, title/elapsed TTL contract, one refresh worker per socket generation, prune confirmation, and layout recovery.

## Inventory

`python3 scripts/check-parity-inventory.py` covers 105 frozen entrypoints. Every inventory row is `passed` except:

| ID | Status | Reason |
| --- | --- | --- |
| `safety-lock` | blocked | Linux flock proofs exist; macOS native proofs are owner-run after the PR |
| `cli-compiled-min-path` | in-progress | Linux compiled artifact passed; macOS artifact is owner-run after the PR |

No unexplained Python/TypeScript behavior differences were left unmarked. Shared CLI cases in `tests/cli/differential.test.ts` compare help, unknown-command, plugin-id errors, sidebar-install config bytes, install `--dry-run`, doctor exit 0, tint enable/disable restore, and install/uninstall byte restore in separate sandboxes. Every command and alias keeps the same plugin-id and pending-import guards. `rewriteArgv` keeps extra argv for every alias (`tests/unit/catalog.test.ts`). Python uninstall restores a TypeScript-installed fixture, and TypeScript uninstall restores a Python-installed fixture. Log JSON spacing is a documented incidental difference.

## Automated results (Linux x86_64)

| Check | Outcome |
| --- | --- |
| `bun run typecheck` | pass |
| `bun run lint` | pass |
| `bun run test` | 298 pass |
| `bun run test:runtime` | 25 pass |
| `bun run test:artifact` | 4 pass |
| `bun run test:herdr` | pass against Herdr 0.9.0 after isolate-preload wipes `HERDR_BIN_PATH`: transport, `config check`, TypeScript install/uninstall restore, and Python uninstall of a TypeScript-installed fixture |
| `bun run test:parity` | 105 entrypoints |
| `python3 -m unittest discover -s tests -t tests` | 280 pass |
| `scripts/check-standalone.py` | passed; receipt in `evidence/step-7-standalone-receipt.json` |

Evidence: `evidence/step-7-package.md`, `evidence/step-7-bench.json`, plus earlier slice files under `evidence/`.

## Manual review

Architecture stays command-thin with Effect at I/O boundaries (lock, RPC, TTY, worker). Anti-slop and the no-module-mocking lint fixtures remain enabled. Public docs still describe the product, not the migration diary. Licence notices were not removed.

macOS native lock, TTY, and compiled-min-PATH proofs were not run here. The owner will run them after the PR is open.

## Performance

Eight isolated samples, `PATH=/usr/bin:/bin` for the compiled binary. Medians: Python `--help` 35.8 ms, compiled `--help` 33.7 ms, bun-source `--help` 96.2 ms. Malformed-event medians: Python 51.7 ms, compiled 33.8 ms. Event times vary with host load.

Refresh-worker after the first one-pane heartbeat (CLK_TCK=100): Python 21_260 KB RSS, 5.9 ms round, 0.03 s user CPU; compiled 44_188 KB RSS, 4.3 ms round, 0.03 s user + 0.01 s system CPU. Package size: Python sources 226_695 bytes; compiled `dist/mosaic` 81_823_200 bytes because Bun embeds its runtime. Standalone refresh rounds were 0.3–0.4 s for one pane. TypeScript is not required to outperform Python.

## Remaining non-blocking risks

- macOS native proofs (flock, TTY, compiled PATH) are still outstanding by owner choice. Run `bash scripts/check-native-runtime.sh` after installing Herdr with `scripts/ci/install-herdr.sh`.
- The compiled binary and worker RSS are larger than Python because Bun embeds its runtime. Round CPU and wall-time stay in the same range.
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
