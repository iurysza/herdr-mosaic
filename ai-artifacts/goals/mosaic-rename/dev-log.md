# Mosaic rename

## 2026-09-08

The user approved the name Mosaic, plugin ID `iurysza.mosaic`, repo name `herdr-mosaic`, a Clockwork-style README rewrite, and the GitHub repo rename. They clarified that the README should sound like a person and should not sell the plugin. No tagline or artwork was added.

## Work location

The existing `herdr-window-manager` checkout is linked and enabled in the live Herdr registry. Editing it would change running hook code. All changes are in a separate worktree:

- Path: `~/dev/personal/tools/herdr-mosaic`
- Branch: `rename/mosaic`
- Starting commit: `fa53e1a`

The original checkout and its pre-existing untracked files are untouched. No live plugin, config, keybindings, settings, or state were changed.

## Changes

- Renamed the manifest, runtime ID, picker title, actions, diagnostics, and tests to Mosaic.
- Added explicit Window Manager import to `src/migrate.py`. It preserves state and restore records, copies settings, rules, and config snapshots, and leaves source files intact.
- Existing destination files are never overwritten by the Window Manager import. Equal files allow retries. The state file is written last. A receipt prevents later Chromatic reimport after legacy state cleanup.
- Startup waits for migration when legacy data exists. A stale registry entry cannot run Mosaic as Window Manager.
- Rewrote the README as a usage guide. Moved action, settings, migration, and safety details into linked docs.
- Updated contributor guidance, release naming, provenance, and the existing isolated rehearsal script. Historical evidence and goal packages retain their old names.

The documented upgrade restores and unlinks Window Manager before enabling Mosaic. User-managed layout bindings and external refresh-service paths still need changes during that later cutover.

## Validation

From the Mosaic worktree:

```sh
/usr/bin/python3 -m py_compile src/*.py tests/*.py
/usr/bin/python3 -m unittest discover -s tests -t tests
git diff --check
```

All checks passed. The suite has 205 tests, including migration preservation, conflict refusal, interrupted-copy retry, repeat import, restore/install/uninstall, local documentation links, and documented action names. Existing config tests use the real `herdr config check` binary. Migration lifecycle tests stub runtime RPC responses.

Test output for this session: `/tmp/herdr-mosaic-tests.log`.

No live UI or isolated Herdr server rehearsal was run. The older rehearsal script still requires its machine-specific upstream fixtures.

## Blocked or pending

GitHub returned HTTP 401. `gh auth status` reports an invalid token for `iurysza`. The authorized rename command failed without changing the repo:

```sh
gh repo rename herdr-mosaic --repo iurysza/herdr-window-manager --yes
```

The user needs to authenticate with `gh auth login -h github.com`. After authentication, retry the rename, verify the resulting repo URL, and update origin to `git@github.com:iurysza/herdr-mosaic.git`.

No commit or push was made. Show the change summary and obtain approval before publishing. The README's new GitHub install URL will not work until the remote rename and code publication finish.

## Final standalone pass

The parent explicitly authorized completing the standalone prerequisite and
publication, with this checkout as the sole plugin writer. No further name
approval is needed. This section supersedes the earlier dependency and approval
notes.

Implemented:

- `sidebar.py` publishes tab labels in the space colour, with native-name
  fallbacks. Titles are durable. Elapsed labels retain last-observed-completion
  semantics and expire after 45 seconds. The existing metadata source names are
  preserved. Themed model-tier metadata is never written or cleared.
- `refresh.py` starts one detached stdlib Python worker per Herdr socket
  generation. Setup/startup launch it, relevant events recover a missing worker,
  and it refreshes every 30 seconds. It exits after disable, unlink, uninstall,
  or server replacement. No external scheduling service is required.
- Setup retargets Window Manager plugin-action bindings through `config_patch`,
  saving their exact original text. Uninstall restores unchanged bindings and
  leaves user edits alone. Failed-write retries are covered.
- Dry-run setup never publishes metadata or starts a worker.
- Release Please now names `herdr-mosaic`, uses explicit generic extra-file
  updaters, and has its required `version.txt`. All version files remain 0.1.0.
  The candidate commit uses `Release-As: 0.1.0` as a one-off first-release footer.
- Verify can be dispatched against the exact generated release branch when
  GITHUB_TOKEN-created PR events do not trigger checks. Its existing read-only
  permissions are unchanged. It also runs the isolated standalone check.

Validation:

- 223 unit/integration tests passed with `/usr/bin/python3`.
- Python compilation, installer shell syntax, and `git diff --check` passed.
- Real isolated lifecycle passed on local Herdr 0.8.2. It proves native install
  action success, coloured titles, an observed completion, timer-only clock
  advancement, server restart, singleton reuse, disabled-worker exit, elapsed
  expiry, durable titles, themed-token preservation, and byte-exact uninstall.
- Sanitized evidence is in `standalone-receipt.json`. Full local evidence is in
  `/tmp/mosaic-proof-fdwt40bs/receipt.json` and `/tmp/mosaic-final-unit.log`.
- No proof workers remained after cleanup. No live cutover or external-service
  removal occurred.

The local standalone prerequisite is met. GitHub Verify still needs to pass on
this candidate's published SHA; old-main receipts are not Mosaic verification.
Release Please PR permissions and its generated 0.1.0 PR/tag must still be
checked before a release is merged.

Auth owner checked that no old login process remained, then started one official
`gh auth login --web` flow and relayed its prompt to the parent. That device code
expired without authorization. No logout, token copying, secret change, or
credential deletion occurred. Remote rename/push/release remain blocked on user
browser authorization. Do not pin an unpublished candidate as a released Mosaic.

## Release gate and public presentation

GitHub authentication completed through the parent's official browser flow.
The repository is now `iurysza/herdr-mosaic`. Candidate `35f949c` was pushed
normally and passed Verify (run 34239244606). Release Please created PR #1
for 0.1.0. Repository workflow defaults remain read-only; PR creation is enabled.

Verify on release head `b9a539a` failed (run 34239342869): Linux reused the Unix
socket inode on restart. Generation now includes `st_ctime_ns`, not just path,
device, and inode. A regression test covers identical inodes with changed
creation metadata. The real lifecycle check remains unchanged in scope and now
prints its receipt and socket identities to CI logs. This is a runtime fix,
not a rerun or weakened assertion.

The user changed the public presentation scope before release: Mosaic is a new
experimental product. README and user docs no longer advertise migration,
ancestry, personal rollout steps, or internal coordination receipts. Compatibility
and cutover guides and provenance are retained here; runtime compatibility,
regression coverage, and LICENSE notices remain intact. Release-owner bootstrap
notes are retained in `release-owner-notes.md`. A separately supplied wordmark
will be integrated before the final exact-SHA gates and release merge.

The runtime fix is published as `2814cb0749bde1b6fb3f5b9701bec4974192c7d1`.
Linux Verify run 34240742861 passed. Its receipt proves the exact reuse case:
the socket inode remained 8936337, while `st_ctime_ns` changed and a new worker
started successfully. Local full lifecycle also passed; the current local suite
has 225 tests including the public-presentation regression.

The parent reviewed the minimal README and 2172×724 wordmark. They are integrated
with the full restore command and US spelling in public copy. Banner generation
prompts/process are not part of the public README. Final candidate and release-PR
verification still precede release merge; no live setup has been activated.

Separate auth note: the official gh flow warned that credentials were saved in
plain text. No credential file was read, rewritten, deleted, or copied by this
publisher; this warning was reported separately rather than blocking release.
