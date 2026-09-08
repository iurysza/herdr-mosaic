# Release Window Manager

Window Manager uses the same loop as Clockwork: Conventional Commits, a Release Please pull request, then a GitHub Release from the merged tag. Releases are source only. There is no compiled archive.

## Publish a release

1. Merge Conventional Commit changes into `main`.
2. Release Please opens or updates a release pull request.
3. Review that pull request. Do not merge it until a fresh install can show the agreed sidebar without the external title publisher.
4. Merge the release pull request.
5. Release Please creates the `vX.Y.Z` tag and the GitHub Release.

Let Release Please create tags and GitHub Releases. It tracks the current version in [`.release-please-manifest.json`](../.release-please-manifest.json).

## Versioning

- `feat:` creates a minor release while the version is below 1.0.
- `fix:` creates a patch release.
- `feat!:` or a breaking-change footer creates a minor release while the version is below 1.0.
- `docs:`, `ci:`, `chore:`, and pure `refactor:` commits do not release.

The current version is `0.1.0`. That version is not published as a GitHub Release until the sidebar gate above passes.

## Check before merging

The [Verify workflow](../.github/workflows/verify.yml) must pass:

```sh
python3 -m py_compile src/*.py tests/*.py
python3 -m unittest discover -s tests -t tests
```

CI installs a pinned Herdr CLI so `herdr config check` can run. It does not start a Herdr server.
