# Plan

Use Clockwork's release loop without its Rust build. One Ubuntu job downloads a pinned Herdr CLI, runs the existing tests, and Release Please opens version pull requests from Conventional Commits.

## Approach

`herdr config check` is the only reason CI needs Herdr. Pin `v0.9.0` `linux-x86_64` with its published SHA-256. Do not start a server.

Keep the first GitHub Release unmerged until the sidebar no longer needs the external publisher.

## Steps

1. Add `scripts/ci/install-herdr.sh` with pinned URL and checksum. Fail on mismatch.
2. Add `.github/workflows/verify.yml` on pull requests and pushes to `main`. Permissions: `contents: read`. Install Python 3.11, install Herdr, compile `src` and `tests`, run `python3 -m unittest discover -s tests -t tests`.
3. Set the plugin version to `0.1.0` in `herdr-plugin.toml` and `src/ctx.py` with Release Please markers. Add `release-please-config.json` (`simple`, `bump-minor-pre-major`, `include-v-in-tag`) and `.release-please-manifest.json` at `0.1.0`.
4. Add `.github/workflows/release-please.yml` matching Clockwork: push to `main` plus `workflow_dispatch`, `contents: write` and `pull-requests: write`, `googleapis/release-please-action@v4`. Use `GITHUB_TOKEN`. Do not add a cargo-dist release job.
5. Add `docs/releases.md` and point the README at it. State the standalone-sidebar gate. Do not merge a release pull request in this change.
6. Commit and push `main`.

## Verification

- `/usr/bin/python3 -m py_compile src/*.py tests/*.py`
- `/usr/bin/python3 -m unittest discover -s tests -t tests`
- `bash -n scripts/ci/install-herdr.sh`
- Confirm version strings match in the manifest files.

## Risks

- `GITHUB_TOKEN` can open the Release Please pull request. A follow-up workflow on the tag may not run until a `RELEASE_PLEASE_TOKEN` PAT exists. That is acceptable because this plugin has no binary upload job.
- First Release Please PR after later `feat` commits may be `0.2.0`. Leave `0.1.0` unreleased until the sidebar gate passes.
