# Mosaic

Mosaic is a Herdr plugin for space colours, agent grouping, and pane layouts.

Each space gets a colour marker in the sidebar. You can also tint the window to match the current space. Agents stay grouped by space, and layout actions let you equalize or resize panes without closing them.

- Pick a colour or let Mosaic assign one.
- Show agents from all spaces or only the current space.
- Equalize panes, cycle layouts, or resize in any direction.
- Keep Herdr's status colours. A blocked agent stays red regardless of its space's colour.

## Install

Mosaic needs Herdr 0.8.0 or newer and Python 3.6 or newer at `/usr/bin/python3`. It runs on macOS and Linux and uses no Python packages.

If you use Window Manager or Chromatic Spaces, follow the [migration guide](./docs/migration.md) first. Do not leave both plugins enabled.

Mosaic publishes agent titles and refreshes elapsed labels itself. It needs no external service. Model-tier labels are optional and come from themed Pi. See [sidebar refresh](./docs/settings.md#sidebar-refresh).

Install from GitHub, then apply the sidebar templates and agent grouping:

```sh
herdr plugin install iurysza/herdr-mosaic
herdr plugin action invoke iurysza.mosaic.install
```

The setup action assigns colours, starts the sidebar refresh worker, and binds the picker to `prefix+i` if that key is free. Tint stays off on a fresh install.

For a local checkout, use `herdr plugin link /path/to/herdr-mosaic` instead of the GitHub install command. Then run the same setup action.

## Set a space colour

Focus the space you want to change, then open the picker:

```sh
herdr plugin action invoke iurysza.mosaic.set-identity
```

Choose a colour. The marker beside that space's name changes to match it. You can reopen the picker with `prefix+i` if Mosaic bound that key during setup.

To tint the window as you switch spaces:

```sh
herdr plugin action invoke iurysza.mosaic.tint-enable
```

Switch to another space to see its tint. Use tint with one active Herdr session, because sessions share the same config file.

To stop tinting and restore your previous theme values:

```sh
herdr plugin action invoke iurysza.mosaic.tint-disable
```

See [colours and tint](./docs/settings.md#colours-and-tint) for the palette, custom colours, and intensity settings.

## Group agents by space

Setup groups agents by space, then tab and pane. It does not change agent detection, status, or notifications.

To show only agents in the current space:

```sh
herdr plugin action invoke iurysza.mosaic.show-current-space-agents
```

To show all agents again:

```sh
herdr plugin action invoke iurysza.mosaic.show-all-agents
```

Herdr's Agents panel does not have collapsible group headers. Use Mosaic's `open-agent-board` action for a read-only popup with collapsible groups.

## Arrange panes

Unzoom the tab before changing its layout. To give its panes equal-width columns:

```sh
herdr plugin action invoke iurysza.mosaic.equalize
```

To cycle through the layout presets:

```sh
herdr plugin action invoke iurysza.mosaic.cycle
```

The `resize-left`, `resize-down`, `resize-up`, and `resize-right` actions resize the current pane by 2%. See [actions and keybindings](./docs/actions.md) to bind these to keys.

## Check or remove Mosaic

To inspect the config, sidebar templates, and plugin state:

```sh
herdr plugin action invoke iurysza.mosaic.doctor
```

Run Mosaic's restore action before removing the plugin:

```sh
herdr plugin action invoke iurysza.mosaic.uninstall
```

For a linked checkout, follow with `herdr plugin unlink iurysza.mosaic`. For a GitHub install, use `herdr plugin uninstall iurysza.mosaic`.

Mosaic restores the config values it recorded before setup. It leaves keys you changed manually alone and keeps your space identities for a later reinstall.

## Documentation

- [Actions and keybindings](./docs/actions.md).
- [Settings, colours, and sidebar refresh](./docs/settings.md).
- [Migration from Window Manager or Chromatic Spaces](./docs/migration.md).
- [Config safety and limitations](./docs/config-safety.md).
- [Releases](./docs/releases.md) and [upstream credits](./docs/provenance.md).

## Development

Run the tests:

```sh
python3 -m unittest discover -s tests -t tests
```

CI also runs `python3 scripts/check-standalone.py` against an isolated Herdr server. That check covers fresh setup, title publication, elapsed refresh, restart, and uninstall without the old external service.

Plugin code lives in `src/`. See [AGENTS.md](./AGENTS.md) for contributor instructions and [Herdr API findings](./docs/herdr-api-findings.md) for verified API behaviour.

Mosaic is [MIT licensed](./LICENSE). Chromatic Spaces portions remain Copyright (c) 2026 Jack Dalton.
