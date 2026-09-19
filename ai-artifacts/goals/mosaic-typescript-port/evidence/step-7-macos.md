# Step 7 macOS Verify

Worktree: `/workspace` on `cursor/mosaic-typescript-port-1529`. Isolated checkout. Default Herdr session unused.

Candidate: `ee0b54b`. GitHub Actions run [35470501982](https://github.com/iurysza/herdr-mosaic/actions/runs/35470501982).

| Job | Result |
| --- | --- |
| `verify (macos-latest)` | success, including TypeScript candidate and standalone |
| `verify (ubuntu-latest)` | success, including TypeScript candidate, bench, and standalone |

macOS TypeScript candidate covered typecheck, lint, `bun run test` 299, parity 105, `test:runtime` (flock, PTY, worker), `bun run build`, `test:artifact`, and `test:herdr` against Herdr 0.9.0. Standalone install, timer refresh, restart, and uninstall ran through `dist/mosaic` on Darwin.

Darwin-specific production fixes in this candidate: `resolveSocketPath` realpaths the socket parent directory when libuv `realpathSync` returns `EOPNOTSUPP`; isolated tests use `/tmp` so unix socket paths fit `sun_path`.
