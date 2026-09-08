# Release Mosaic

Mosaic uses the same loop as Clockwork: Conventional Commits, a Release Please pull request, then a GitHub Release from the merged tag. Releases are source only. There is no compiled archive.

## Publish a release

1. Merge Conventional Commit changes into `main`.
2. Release Please opens or updates a release pull request.
3. Review that pull request. Require Verify on its exact head commit, including the isolated standalone install/restart test. Missing checks are not success.
4. Merge the release pull request.
5. Release Please creates the `vX.Y.Z` tag and the GitHub Release.

Let Release Please create tags and GitHub Releases. It tracks the current version in [`.release-please-manifest.json`](../../../.release-please-manifest.json).

If the workflow fails with *GitHub Actions is not permitted to create or approve pull requests*, turn on **Allow GitHub Actions to create and approve pull requests** under **Settings → Actions → General → Workflow permissions**, then re-run the job. Preserve the existing default workflow permissions.

The workflow prefers `RELEASE_PLEASE_TOKEN` and falls back to `GITHUB_TOKEN`. PR events created by `GITHUB_TOKEN` normally do not trigger Verify. The repository checkbox fixes PR creation, not that event restriction. If no dedicated token is configured, explicitly run Verify against the generated release branch:

```sh
gh workflow run verify.yml --repo iurysza/herdr-mosaic --ref <release-branch>
gh run list --repo iurysza/herdr-mosaic --workflow Verify --json databaseId,headSha,status,conclusion,url
```

Check that the successful run's `headSha` equals the release PR's head SHA before merging. Do not copy another repository's credentials.

## Versioning

- `feat:` creates a minor release while the version is below 1.0.
- `fix:` creates a patch release.
- `feat!:` or a breaking-change footer creates a minor release while the version is below 1.0.
- `docs:`, `ci:`, `chore:`, and pure `refactor:` commits do not release.

The first intended release is `0.1.0`. The initial Mosaic feature commit includes the one-off commit-body footer `Release-As: 0.1.0`. This prevents the existing `0.1.0` bootstrap metadata from producing an unintended `0.2.0`. It is not a permanent version override.

The simple release strategy owns `version.txt`. Generic updaters change the marked version lines in `herdr-plugin.toml` and `src/ctx.py`. The version test checks those files against `.release-please-manifest.json`.

Before the first merge, confirm that the generated PR keeps all four files at `0.1.0` and creates tag `v0.1.0`. Do not merge a stale `herdr-window-manager` release branch. Future release commits follow the normal pre-1.0 policy.

## Check before merging

The [Verify workflow](../../../.github/workflows/verify.yml) must pass:

```sh
python3 -m py_compile src/*.py tests/*.py
python3 -m unittest discover -s tests -t tests
python3 scripts/check-standalone.py
```

CI installs a pinned Herdr CLI. The standalone check starts a disposable server with its own HOME, config, plugin registry, state, and socket. It uses no external title publisher, refresh service, agent credentials, or live user setup. It checks native action success, title/clock tokens, a real timer round, restart, optional themed metadata, and byte-exact uninstall.

Mosaic owns title publication and elapsed scheduling. The themed model-tier token remains optional and external.
