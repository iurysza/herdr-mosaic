# Step 2 Linux evidence

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`.
Parent revision: `594869a`. This file is recorded with the follow-up Linux verification commit.

OS: Linux x86_64 (`Linux cursor 6.12.94+`)
Bun: 1.4.2
Node (Oxlint): 22.22.2
TypeScript: 7.0.2
Effect: 4.0.0-rc.116
Oxlint: 1.82.0
anti-slop: `c44ef22`
Herdr: 0.9.0 (protocol 22 from `herdr api schema`), installed to `/tmp/mosaic-tools/herdr` via `scripts/ci/install-herdr.sh`. Never pointed at the default session.

## Commands

```sh
bun run typecheck   # pass
bun run lint        # pass
bun run test        # 20 pass
bun run test:runtime
# 11 pass: flock contend/death/SIGINT/virtual+real timeout, PTY raw/input/resize/cancel/restore,
# worker race exit 0, generation key, no spawn without sidebar, detached session cleanup
bun run test:artifact   # compiled CLI under PATH=/usr/bin:/bin ignores .env and bunfig
bun run test:herdr      # disposable server ping + plugin.list
python3 scripts/check-parity-inventory.py  # 105 entrypoints
```

Default `bun` still loads `bunfig.toml` from cwd even with `--config`; production isolation is the compiled artifact (`--no-compile-autoload-dotenv` / `--no-compile-autoload-bunfig`). Source invocations use `--no-env-file`.

flock FFI opens absolute `/lib/x86_64-linux-gnu/libc.so.6` so tests can `chdir` into disposable HOMEs.

## Blocker

macOS proofs required by fact-09 / fact-20 / plan step 2 were not run. This VM is Linux-only. Need a macOS runner or host for flock, worker ownership, PTY, compiled artifact, and real-Herdr.

Step 3 is not started: the step 2 gate is not fully passed.
