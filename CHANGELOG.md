# Changelog

## Unreleased

- Bind `ctrl+[`, `ctrl+]`, `ctrl+shift+[`, and `ctrl+shift+]` to Herdr's tab and agent cycling when those actions and chords are free.
- Cycle eligible agents newest-first with `ctrl+.` and oldest-first with `ctrl+,`. Each press advances; new activity at the front takes priority. Blocked agents rank ahead of idle and done.
- Add a `prefix+alt+x` stale-agent pruner with a persistent threshold, multi-selection, explicit `x` confirmation, and live eligibility checks before closing panes.
- Group documentation and CLI help by task, with clearer color, tint, agent view, and layout command aliases.
- Clarify menu labels while preserving every existing action ID and binding. No new menu entries or binding migration.
- Make `-h` and `--help` print help without running a command, including after the command name.

## [0.5.1](https://github.com/iurysza/herdr-mosaic/compare/v0.5.0...v0.5.1) (2026-09-23)


### Bug Fixes

* **runtime:** stop Linux flake in detached-worker session test ([#15](https://github.com/iurysza/herdr-mosaic/issues/15)) ([6bdc145](https://github.com/iurysza/herdr-mosaic/commit/6bdc145ba18e6d8d5285103c78c7bbc7c1a89716))

## [0.5.0](https://github.com/iurysza/herdr-mosaic/compare/v0.4.0...v0.5.0) (2026-09-19)


### Features

* **agent-triage:** cycle idle agents and prune stale sessions ([79df0be](https://github.com/iurysza/herdr-mosaic/commit/79df0be0d42250285dc647022a94370116410bc8))
* improve pane and agent workflows ([8e99178](https://github.com/iurysza/herdr-mosaic/commit/8e9917859088f97408b345da76d319f2bf532d31))
* **pane-move:** add pick-and-place pane moves ([8172013](https://github.com/iurysza/herdr-mosaic/commit/817201391cec3eae3943361909c810558b7416cc))

## [0.4.0](https://github.com/iurysza/herdr-mosaic/compare/v0.3.0...v0.4.0) (2026-09-16)


### Features

* **elapsed:** start the clock when an agent launches ([4173672](https://github.com/iurysza/herdr-mosaic/commit/41736722a1809b7cccc4ebb7836a9b63ee5efb2b))

## [0.3.0](https://github.com/iurysza/herdr-mosaic/compare/v0.2.0...v0.3.0) (2026-09-11)


### Features

* **agent-view:** add focus and sort controls ([f8b56fa](https://github.com/iurysza/herdr-mosaic/commit/f8b56fab2d0c1a3aee58d1435e2b2932489aaa1a))

## [0.2.0](https://github.com/iurysza/herdr-mosaic/compare/v0.1.0...v0.2.0) (2026-09-09)


### Features

* **api:** clarify Mosaic actions and add compatible CLI names ([15f8df6](https://github.com/iurysza/herdr-mosaic/commit/15f8df6bcfd9fddac48dd4ea778363f419e6fed4))

## [0.1.0](https://github.com/iurysza/herdr-mosaic/releases/tag/v0.1.0) (2026-09-08)

First experimental release.

- Color-coded spaces and optional window tint.
- Agent grouping with plugin-owned titles and elapsed refresh.
- Pane equalization, layout presets, and directional resizing.
- Reversible config edits and restart-safe refresh workers on macOS and Linux.
