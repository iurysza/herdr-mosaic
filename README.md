# Mosaic

![Mosaic](./assets/mosaic-wordmark.png)

Give each Herdr space a colour, keep agents grouped by space, and arrange the panes in the current tab.

Mosaic is experimental. Back up `config.toml` before setup. Do not run another plugin or service that writes the same sidebar rows, sidebar tokens, or theme values.

## Set up Mosaic

You need Herdr 0.8.0 or newer and Python 3.6 or newer at `/usr/bin/python3`. Mosaic runs on macOS and Linux with the Python standard library only.

```sh
herdr plugin install iurysza/herdr-mosaic
herdr plugin action invoke iurysza.mosaic.install
```

The setup action is Mosaic's consent boundary. It records the values it must restore, then configures these defaults:

- assigns each current space a palette colour
- adds coloured space markers and coloured agent titles to the sidebar
- shows every agent, ordered by space, tab, and pane
- starts title and elapsed-label refresh
- binds `prefix+i` to the colour picker when the key is free
- leaves window tint off

You do not need to configure individual agents.

## Change the current space colour

Focus the space, then open the picker:

```sh
herdr plugin action invoke iurysza.mosaic.set-identity
```

Select a palette colour with the arrow keys and press Enter to save it. If setup added the picker binding, press `prefix+i` instead.

Mosaic shows the space as a coloured marker and uses the same colour for agent titles in that space. A space keeps its colour when you rename it.

## Set an exact colour

The picker accepts a named palette colour and a custom hex colour.

1. Focus the space and open the picker.
2. Select **custom hex...**.
3. Enter `#rrggbb` or `#rgb`, then press Enter.

For scripts or a colour you already know, run this from a Mosaic checkout:

```sh
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py apply-identity --workspace <id> --colour <name|hex>
```

Mosaic saves the exact hex value. If window tint is on, it uses that value for the tint accent. Herdr sidebar styles are static, so the space marker and agent title use the nearest Mosaic palette colour instead. This is a Herdr limit, not a colour conversion error.

## Arrange panes

Mosaic changes only the current tab. Unzoom the tab before you arrange it.

To make equal-width vertical columns:

```sh
herdr plugin action invoke iurysza.mosaic.equalize
```

To move through equal columns, equal rows, a main pane on the left, a main pane at the top, and a tiled layout:

```sh
herdr plugin action invoke iurysza.mosaic.cycle
```

Mosaic temporarily stages panes in another tab while it rebuilds a layout. If a reshape fails, it attempts to move the panes back and reports any panes left in the staging tab.

## Resize a pane

Focus the pane, then use one directional action. Each action adjusts the focused pane by 2%.

```sh
herdr plugin action invoke iurysza.mosaic.resize-left
herdr plugin action invoke iurysza.mosaic.resize-down
herdr plugin action invoke iurysza.mosaic.resize-up
herdr plugin action invoke iurysza.mosaic.resize-right
```

See [actions and keybindings](./docs/actions.md) to add keybindings for actions you use often.

## Restore Mosaic safely

To stop window tint and restore the theme values that existed before tinting:

```sh
herdr plugin action invoke iurysza.mosaic.theme-restore
```

`iurysza.mosaic.tint-disable` does the same job. Mosaic keeps it for compatibility with existing commands and scripts.

To remove Mosaic completely, restore its config before you remove the plugin:

```sh
herdr plugin action invoke iurysza.mosaic.uninstall
herdr plugin uninstall iurysza.mosaic
```

The restore action removes Mosaic's sidebar templates, picker binding, agent view, metadata, and theme overrides. It keeps saved space colours so a later relink can restore them.

## Optionally focus the agent list

By default, setup shows every agent, ordered by space. To temporarily show only agents in the focused space:

```sh
herdr plugin action invoke iurysza.mosaic.show-current-space-agents
```

To return to the default all-space list:

```sh
herdr plugin action invoke iurysza.mosaic.show-all-agents
```

Herdr has no collapsible group headers in its native Agents panel. Open Mosaic's separate Agent Board for collapsible space groups:

```sh
herdr plugin action invoke iurysza.mosaic.open-agent-board
```

The board reads Herdr's agent state. Selecting an agent focuses it.

## Limits in Herdr

- In Herdr 0.9, native workspace, tab, and pane navigation suppresses the focused plugin events that Mosaic needs. Public `herdr` CLI focus commands emit them. An agents-owned keyboard-only workaround sits outside Mosaic and does not repair mouse navigation.
- Herdr sidebar token styles are static. Custom hex values tint chrome exactly, but sidebar markers and titles use the nearest pre-styled palette slot.
- Herdr sessions share one `config.toml`. Use dynamic window tint with one active session.
- Herdr has no theme-introspection API. Set `theme_base` if Mosaic cannot identify your dark theme.
- A `rows_by_agent` config entry replaces the shared agent row for that agent. Mosaic preserves these entries, so affected agents may not show Mosaic's title and elapsed labels.
- Elapsed labels begin only after Mosaic observes an agent move directly from `working` to `idle` or `done`. Changing focus never resets them.

See [config safety and limitations](./docs/config-safety.md) for config ownership and recovery details.

## Check setup and change options

Run Doctor to inspect sidebar ownership, refresh health, config conflicts, and theme state:

```sh
herdr plugin action invoke iurysza.mosaic.doctor
```

See [settings](./docs/settings.md) for palette colours, window tint intensity, markers, label rules, and refresh behaviour.

## Documentation

- [Actions and keybindings](./docs/actions.md)
- [Settings](./docs/settings.md)
- [Config safety and limitations](./docs/config-safety.md)
- [Releases](./docs/releases.md)

Mosaic is [MIT licensed](./LICENSE).
