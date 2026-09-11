# Mosaic

![Mosaic](./assets/mosaic-wordmark.png)

Give each Herdr space a color, keep agents grouped by space, and arrange the panes in the current tab.

Mosaic is experimental. Back up `config.toml` before setup. Do not run another plugin or service that writes the same sidebar rows, sidebar tokens, or theme values.

## Set up Mosaic

You need Herdr 0.8.0 or newer and Python 3.6 or newer at `/usr/bin/python3`. Mosaic runs on macOS and Linux with the Python standard library only.

```sh
herdr plugin install iurysza/herdr-mosaic
herdr plugin action invoke iurysza.mosaic.install
```

The setup action is Mosaic's consent boundary. It records the values it must restore, then configures these defaults:

- assigns each current space a palette color
- adds colored space markers and colored agent titles to the sidebar
- shows every agent grouped by space, with attention inside each group
- starts title and elapsed-label refresh
- binds `prefix+i` to the color picker and `prefix+shift+s` to sorting when the keys are free
- leaves window tint off

You do not need to configure individual agents.

## Change the current space color

Focus the space, then open the picker:

```sh
herdr plugin action invoke iurysza.mosaic.set-identity
```

Select a palette color with the arrow keys and press Enter to save it. If setup added the picker binding, press `prefix+i` instead.

Mosaic shows the space as a colored marker and uses the same color for agent titles in that space. A space keeps its color when you rename it.

## Set an exact color

The picker accepts a named palette color and a custom hex color.

1. Focus the space and open the picker.
2. Select **custom hex...**.
3. Enter `#rrggbb` or `#rgb`, then press Enter.

For scripts or a color you already know, run this from a Mosaic checkout:

```sh
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py apply-identity --workspace <id> --color <name|hex>
```

Mosaic saves the exact hex value. If window tint is on, it uses that value for the tint accent. Herdr sidebar styles are static, so the space marker and agent title use the nearest Mosaic palette color instead. This is a Herdr limit, not a color conversion error.

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

The restore action removes Mosaic's sidebar templates, picker binding, agent view, metadata, and theme overrides. It keeps saved space colors so a later relink can restore them.

## Focus and sort the agent list

By default, setup shows every agent. **Toggle Agent Focus** switches between every space and the focused space. The filter follows space switches.

```sh
herdr plugin action invoke iurysza.mosaic.toggle-agent-focus
```

**Toggle Agent Sort** switches between Activity and Spaces and keeps the focus filter. Setup binds it to `prefix+shift+s`. On this machine, press Ctrl+A, then Shift+S.

```sh
herdr plugin action invoke iurysza.mosaic.toggle-agent-sort
```

- **Activity** prioritizes attention, then recent state changes.
- **Spaces** groups agents by space, then prioritizes attention inside each group.

`show-current-space-agents` and `show-all-agents` remain as set-on and set-off compatibility actions. Herdr 0.8.2 cannot hide them while preserving existing bindings and callers.

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
- Elapsed ages begin after Mosaic observes an agent move directly from `working` to `idle` or `done`. Changing focus never resets them. Published labels use three cells, including a blank placeholder before completion. Ages cap at `99d`. Herdr drops the column if metadata expires. See [elapsed column](./docs/elapsed-column.md).

See [config safety and limitations](./docs/config-safety.md) for config ownership and recovery details.

## Check setup and change options

Run Doctor to inspect sidebar ownership, refresh health, config conflicts, and theme state:

```sh
herdr plugin action invoke iurysza.mosaic.doctor
```

See [settings](./docs/settings.md) for palette colors, window tint intensity, markers, label rules, and refresh behaviour.

## Documentation

- [Actions and keybindings](./docs/actions.md)
- [Settings](./docs/settings.md)
- [Elapsed column](./docs/elapsed-column.md)
- [Config safety and limitations](./docs/config-safety.md)
- [Releases](./docs/releases.md)

Mosaic is [MIT licensed](./LICENSE).
