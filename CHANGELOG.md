# Changelog

## Unreleased

- Group documentation and CLI help by task, with clearer color, tint, agent view, and layout command aliases.
- Clarify menu labels while preserving every existing action ID and binding. No new menu entries or binding migration.
- Make `-h` and `--help` print help without running a command, including after the command name.

## [0.2.0](https://github.com/iurysza/herdr-mosaic/compare/v0.1.0...v0.2.0) (2026-09-09)


### Features

* **api:** clarify Mosaic actions and add compatible CLI names ([15f8df6](https://github.com/iurysza/herdr-mosaic/commit/15f8df6bcfd9fddac48dd4ea778363f419e6fed4))

## [0.1.0](https://github.com/iurysza/herdr-mosaic/releases/tag/v0.1.0) (2026-09-08)

First experimental release.

- Color-coded spaces and optional window tint.
- Agent grouping with plugin-owned titles and elapsed refresh.
- Pane equalization, layout presets, and directional resizing.
- Reversible config edits and restart-safe refresh workers on macOS and Linux.
