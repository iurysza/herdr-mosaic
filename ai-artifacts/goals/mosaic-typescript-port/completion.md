# Mosaic TypeScript port — completion report

Candidate: `77d5f9ae77f2ebb919e0acbbd425deb7c7f4a566` on `cursor/mosaic-typescript-port-1529`. Frozen Python reference remains `8b7bb76` / manifest `0.5.0`. Live cutover was not executed.

## Implemented behavior

Production commands, startup, events, panes, and actions launch `$HERDR_PLUGIN_ROOT/dist/mosaic` through `/bin/sh -c exec`. The compiled binary has no Python runtime dependency. Frozen `src/*.py` stays in the tree as an isolated reference and rollback option.

The TypeScript CLI preserves the reference lock, surgical TOML, byte-exact restore, Window Manager import, Chromatic stale-backup refusal, `rows_by_agent` non-rewrite, `$themed_model_tier` non-ownership, title/elapsed TTL contract, one refresh worker per socket generation, prune confirmation, and layout recovery.

## Inventory

`python3 scripts/check-parity-inventory.py` covers 105 frozen entrypoints. Every inventory row is `passed` except:

| ID | Status | Reason |
| --- | --- | --- |
| `safety-lock` | blocked | Linux flock proofs exist; macOS native proofs are owner-run after the PR |
| `cli-compiled-min-path` | in-progress | Linux compiled artifact passed; macOS artifact is owner-run after the PR |

No unexplained Python/TypeScript behavior differences were left unmarked.

## Automated results (Linux x86_64)

| Check | Outcome |
| --- | --- |
| `bun run typecheck` | pass |
| `bun run lint` | pass |
| `bun run test` | 280 pass |
| `bun run test:runtime` | 25 pass |
| `bun run test:artifact` | 4 pass |
| `bun run test:herdr` | pass against Herdr 0.9.0 |
| `bun run test:parity` | 105 entrypoints |
| `python3 -m unittest discover -s tests -t tests` | 280 pass |
| `scripts/check-standalone.py` | passed; receipt in `evidence/step-7-standalone-receipt.json` |

Evidence: `evidence/step-7-package.md`, plus earlier slice files under `evidence/`.

## Manual review

Architecture stays command-thin with Effect at I/O boundaries (lock, RPC, TTY, worker). Anti-slop and the no-module-mocking lint fixtures remain enabled. Public docs still describe the product, not the migration diary. Licence notices were not removed.

macOS native lock, TTY, and compiled-min-PATH proofs were not run here. The owner will run them after the PR is open.

## Performance

Eight isolated samples. Medians: Python `--help` 35.4 ms, compiled `--help` 33.6 ms, bun-source `--help` 95.2 ms. Malformed-event medians: Python 36.8 ms, compiled 33.9 ms. Package size: Python sources 226_695 bytes; compiled `dist/mosaic` 81_823_200 bytes because Bun embeds its runtime. Standalone refresh rounds were 0.3–0.4 s for one pane. TypeScript is not required to outperform Python.

## Remaining non-blocking risks

- macOS native proofs (flock, TTY, compiled PATH) are still outstanding by owner choice.
- The compiled binary is large relative to the Python sources. That is the Bun compile payload, not application source growth.
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
3. Register it and invoke `install`. TypeScript-written `state.json` and restore records remain readable by that Python (see `tests/unit/state.test.ts` and sidebar backup round-trip tests).
4. Keep Chromatic/Window Manager source directories; do not apply Chromatic `sidebar_backup` / `theme_backup` / `last_written`.

Do not run install, doctor, or uninstall against the default session until cutover is approved.
