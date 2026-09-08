# Intent

## Outcome

Prepare CI and release automation for Herdr Window Manager using Clockwork's release process. Contributors get repeatable checks. Maintainers release through a reviewed Release Please pull request rather than manual tags.

## Audience and problem

The repository is public but has no CI, tags, releases, or configured Actions secrets. The current sidebar still depends on a machine-managed title publisher and refresh service. Release automation must not imply that a fresh install is self-contained.

## Scope

- GitHub Actions verification for the Python plugin and native Herdr integration.
- Clockwork's Conventional Commits, Release Please pull request, version tag, GitHub Release, and release-validation flow.
- Consistent versions in the manifest, Python constant, release metadata, and changelog.
- Source distribution and native Herdr installation checks, without compiled binaries or cargo-dist.
- Public-readiness review of tracked files, history, documentation, and attribution.
- An explicit first-release gate for the standalone sidebar requirement.

## Non-goals

- Implementing the remaining standalone title publisher and refresh lifecycle in this CI goal.
- Adding types, changing the runtime dependency policy, or refactoring product behavior.
- Modifying live Herdr, the work Mac, Clockwork, or other repositories.
- Pushing, creating secrets, changing repository settings, tagging, or publishing without separate approval.

## Constraints

- Runtime stays Python standard library only. Current project instructions require Python 3.6+ and `/usr/bin/python3`.
- CI must use real pinned Herdr validation, not silently skip tests when the binary is missing.
- Tests and install checks must use isolated HOME, config, state, registry, and socket paths.
- Public pull requests must not receive release credentials.
- Retain upstream license notices and resolve any attribution gaps before release.
- Do not copy credentials from Clockwork. Inspect only secret names and configure access separately with approval.

## Decisions

- Use Clockwork's release process, approved in chat.
- Start at 0.1.0 and use Clockwork's pre-1.0 version policy. The user approved the recommended interview choices in chat after the interview command was aborted.
- Prepare CI now. Hold the first release until the agreed standalone sidebar works. Completing that product work is a separate prerequisite.

## Evidence

- Plugin checkout: `e220080`, branch `main`, tracking `origin/main` at inspection.
- GitHub reports `iurysza/herdr-window-manager` as PUBLIC. There are no tags or GitHub Releases.
- Clockwork reference: `27a5871212e2e0643fcb623c145f1a1fdf58040b`.
- Reference files: `.github/workflows/verify.yml`, `release-please.yml`, `release.yml`, `release-please-config.json`, `.release-please-manifest.json`, and `docs/releases.md` in Clockwork.
- Clockwork has `RELEASE_PLEASE_TOKEN`. Window Manager has no Actions secrets listed.
- Current local suite: 188 passing tests, previously run with Python 3.9.6 and Herdr 0.9.0. This is not proof of the advertised Python 3.6 or Herdr 0.8.0 floors.
- The README and provenance document lag behind the new settled tracker and plugin-owned elapsed renderer.
- Tracked evidence and planning files contain machine paths and session identifiers. Their presence is not proof of leaked secrets; review is required before further publication.

## Assumptions

- macOS and Linux remain intended platforms unless compatibility checks show the existing claim needs correction.
- GitHub-hosted source plus an optional curated source archive replaces Clockwork's architecture-specific binary assets.

## Open questions

- Which pinned Herdr downloads and integrity checks are available for both CI platforms?
- Can the stated minimum Python and Herdr versions pass the real checks? Do not silently raise the floors if they cannot.
- Does the public-source audit find anything requiring separately approved history remediation?
