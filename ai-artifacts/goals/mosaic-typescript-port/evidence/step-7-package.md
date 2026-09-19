# Step 7 exact candidate (Linux)

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default Herdr session unused. macOS native proofs remain owner-run after the PR is open. Step 2 is not marked complete.

Candidate: `77d5f9ae77f2ebb919e0acbbd425deb7c7f4a566`

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
| `bun run test` | 280 pass |
| `bun run test:runtime` | 25 pass |
| `bun run test:parity` | 105 entrypoints |
| `bun run test:artifact` | 4 pass |
| `bun run test:herdr` | ping + plugin.list on disposable 0.9.0 |
| Python unittest | 280 pass |
| `check-standalone.py` | `result: passed` |

Standalone receipt: `evidence/step-7-standalone-receipt.json`. Install, view/sort toggles, title+elapsed publish, 30s timer advance (`1m` → `2m` with U+2800 pad), socket-generation restart, disable expiry, uninstall byte-restore all succeeded through `dist/mosaic`. `$themed_model_tier` stayed `fixture-tier`.

## Benches

Eight samples each, isolated HOME/socket, `PATH=/usr/bin:/bin` for the compiled binary. Medians:

| Run | median ms | exit |
| --- | --- | --- |
| python `--help` | 35.4 | 0 |
| bun source `--help` | 95.2 | 0 |
| `dist/mosaic --help` | 33.6 | 0 |
| python malformed event | 36.8 | 0 |
| `dist/mosaic` malformed event | 33.9 | 0 |

Source bun is slower because it loads TypeScript. The compiled binary matches Python startup on this host. Worker CPU/memory was not sampled beyond standalone round duration (0.3–0.4 s for one pane).

## Remaining

macOS flock, TTY, compiled-min-PATH, and artifact proofs are owner-run after the PR is open. Live cutover is out of scope.
