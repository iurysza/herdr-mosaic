# Facts

- Pull requests and pushes to `main` run one Linux verification job with pinned Python and a pinned Herdr CLI used only for `herdr config check`.
- A missing or checksum-mismatched Herdr CLI fails the job. Checks do not skip.
- Verification compiles plugin Python and runs the existing isolated unittest suite. It does not start a Herdr server or use a live user setup.
- Conventional Commits drive a Release Please pull request. Merging that pull request creates a `v`-prefixed tag and GitHub Release. The first intended release is `0.1.0`, with Clockwork's pre-1.0 bump policy.
- `herdr-plugin.toml`, `src/ctx.py`, Release Please metadata, and the release tag stay on the same version.
- Releases are source-only. No cargo-dist and no compiled archives.
- The first GitHub Release stays blocked until a fresh install can render the agreed sidebar without the external title publisher. Setting up automation does not publish that release by itself.
- Pull-request verification is read-only and has no release credentials. This work does not change live Herdr, other repositories, or GitHub secrets.
