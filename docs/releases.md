# Releases

Mosaic is experimental. Releases contain the Python source and plugin manifest; there is no compiled archive or Python package to install.

Find published versions and release notes on [GitHub Releases](https://github.com/iurysza/herdr-mosaic/releases). Herdr installs the plugin from its repository:

```sh
herdr plugin install iurysza/herdr-mosaic
herdr plugin action invoke iurysza.mosaic.install
```

Back up your Herdr config before installing or updating Mosaic. Review the release notes for changes to settings, actions, and config ownership.

## Versioning

Mosaic follows a pre-1.0 version policy:

- Features and breaking changes increase the minor version.
- Fixes increase the patch version.
- Documentation-only changes do not create a release.

The version in `version.txt`, `herdr-plugin.toml`, `src/ctx.py`, and `.release-please-manifest.json` must match.

## Publishing

Conventional Commits on `main` update a Release Please pull request. Merging that pull request creates the version tag and GitHub Release.

Require [Verify](../.github/workflows/verify.yml) to pass on the exact release PR head before merging. It runs the unit tests and an isolated Herdr install, timer refresh, restart, and uninstall check. Missing checks are not success.

If a release PR has no automatic check, dispatch Verify against its branch and confirm the run's `headSha` matches the PR:

```sh
gh workflow run verify.yml --repo iurysza/herdr-mosaic --ref <release-branch>
gh run list --repo iurysza/herdr-mosaic --workflow Verify --json headSha,status,conclusion,url
```
