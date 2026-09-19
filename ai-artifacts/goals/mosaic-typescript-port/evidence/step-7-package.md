# Step 7 exact candidate (Linux)

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default Herdr session unused. macOS native proofs remain owner-run after the PR is open. Step 2 is not marked complete.

Candidate: `27efbe400bf63080341c5666e95ab5d0b6ce426c` (artifact hash unchanged from `77d5f9a`)

## Artifact

| Field | Value |
| --- | --- |
| Host | Linux x86_64 6.12.94+ |
| Bun | 1.4.2 |
| TypeScript | 7.0.2 |
| Effect | 4.0.0-rc.116 |
| Oxlint | 1.82.0 |
| Node | 22.22.2 |
| Python (reference) | 3.12.3 |
| Herdr | 0.9.0 protocol 22 |
| Build | `bun run build` → `dist/mosaic` |
| `dist/mosaic` sha256 | `2a55c5abae4bba0ce729bed3f22c15c88b04141f1dd7b8368a79fe9779549a05` |
| `dist/mosaic` size | 81_823_200 bytes (Bun compiled runtime) |
| Python `src/*.py` | 226_695 bytes |

The production manifest launches `exec "$HERDR_PLUGIN_ROOT/dist/mosaic" <argv>` through `/bin/sh -c`. Worker spawn uses the compiled binary with `["refresh-worker", key]`. Frozen Python remains in the tree and is not a launch command.

Compiled argv drops Bun's `/$bunfs/root/mosaic` placeholder (`processCliArgv` in `src/dispatch/catalog.ts`).

## Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run test:runtime
bun run test:parity
bun run build
bun run test:artifact
bun run test:herdr
bun run bench
python3 -m unittest discover -s tests -t tests
HERDR_BIN_PATH=/tmp/mosaic-tools/herdr python3 scripts/check-standalone.py
```

Linux x86_64 outcomes:

| Command | Result |
| --- | --- |
| typecheck | pass |
| lint | pass |
| `bun run test` | 292 pass |
| `bun run test:runtime` | 25 pass |
| `bun run test:parity` | 105 entrypoints |
| `bun run test:artifact` | 4 pass |
| `bun run test:herdr` | ping + plugin.list, `config check` of a TypeScript-installed sidebar, and install/uninstall byte restore on a disposable server |
| Python unittest | 280 pass |
| `check-standalone.py` | `result: passed` |

Standalone receipt: `evidence/step-7-standalone-receipt.json`. Install, view/sort toggles, title+elapsed publish, 30s timer advance (`1m` → `2m` with U+2800 pad), socket-generation restart, disable expiry, uninstall byte-restore all succeeded through `dist/mosaic`. `$themed_model_tier` stayed `fixture-tier`.

## Benches

Eight samples each, isolated HOME/socket, `PATH=/usr/bin:/bin` for the compiled binary. Worker samples use one FakeHerdr pane, wait for the first heartbeat, read `/proc/<pid>/status` VmRSS and `/proc/<pid>/stat` (CLK_TCK=100), then SIGTERM. `MOSAIC_TEST_ISOLATED` is unset so the worker stays alive after the round. Raw output: `evidence/step-7-bench.json`.

Medians and worker resources:

| Run | result |
| --- | --- |
| python `--help` | 35.8 ms, exit 0 |
| bun source `--help` | 96.2 ms, exit 0 |
| `dist/mosaic --help` | 33.7 ms, exit 0 |
| python malformed event | 51.7 ms, exit 0 |
| `dist/mosaic` malformed event | 33.8 ms, exit 0 |
| python `refresh-worker` | 21_260 KB RSS; 5.9 ms round; 0.03 s user CPU; 1 agent |
| `dist/mosaic refresh-worker` | 44_188 KB RSS; 4.3 ms round; 0.03 s user + 0.01 s system CPU; 1 agent |

Source bun is slower because it loads TypeScript. The compiled binary matches Python startup on this host. The compiled worker holds about twice Python's RSS because Bun embeds its runtime; round wall-time and CPU ticks stay in the same range. TypeScript is not required to outperform Python.

Python `sidebar-remove` restored TypeScript-installed `users_real` config bytes in `tests/cli/sidebar.test.ts`. `tests/cli/differential.test.ts` compares help, unknown-command, plugin-id, and sidebar-install config bytes in separate Python and TypeScript sandboxes.

## Remaining

Isolate-preload still points `HERDR_BIN_PATH` at `missing-herdr`. The host binary is captured on `MOSAIC_HERDR_BIN` before that wipe so `bun run test:herdr` can find Herdr 0.9.0 in GitHub Actions.

`tests/cli/differential.test.ts` also compares install then uninstall byte restore. Python uninstall restores a TypeScript-installed fixture, and TypeScript uninstall restores a Python-installed fixture. `tests/herdr/lifecycle.test.ts` runs the same cycle against a disposable Herdr 0.9.0 server after `plugin link --disabled` and `plugin.enable`.

macOS flock, TTY, compiled-min-PATH, and artifact proofs are owner-run after the PR is open (`bash scripts/check-native-runtime.sh`). Live cutover is out of scope.
