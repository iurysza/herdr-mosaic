# Dev Log

Status: In progress

## 2026-09-08

Approved in chat: Clockwork process, start at 0.1.0, one Linux CI job, pinned Herdr CLI only for `herdr config check`, no Plannotator, commit and push.

Implemented:
- `scripts/ci/install-herdr.sh` pins Herdr 0.9.0 linux-x86_64
- `.github/workflows/verify.yml` and `release-please.yml`
- version `0.1.0` in manifest files
- `docs/releases.md`

Checks: `bash -n scripts/ci/install-herdr.sh`; 189 tests OK.
