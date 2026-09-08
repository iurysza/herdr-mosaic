# Mosaic

![Mosaic](./assets/mosaic-wordmark.png)

Color your Herdr spaces, group agents, and arrange panes.

Mosaic is experimental. Back up Herdr's config before you install it. Do not run another plugin or service that writes the same sidebar templates or theme values.

## Install

You need Herdr 0.8.0 or newer and Python 3.6 or newer at `/usr/bin/python3`. Mosaic runs on macOS and Linux with the Python standard library only. It publishes agent titles and elapsed labels without an extra service. Model-tier labels are optional.

Install from GitHub, then run setup:

```sh
herdr plugin install iurysza/herdr-mosaic
herdr plugin action invoke iurysza.mosaic.install
```

Setup assigns space colors, groups agents by space, and starts title and elapsed refresh. It binds the color picker to `prefix+i` if that key is free. Window tint starts off.

## First steps

### Pick a space color

Focus a space in Herdr, then open the picker:

```sh
herdr plugin action invoke iurysza.mosaic.set-identity
```

Choose a color for the space marker and its agent titles. Use `prefix+i` to reopen the picker if setup added that binding.

To tint the window as you switch spaces:

```sh
herdr plugin action invoke iurysza.mosaic.tint-enable
```

Use tint with one active Herdr session because sessions share the config file. To turn it off and restore the previous theme values, run `herdr plugin action invoke iurysza.mosaic.tint-disable`.

### Focus the agent list

Show only agents in the current space:

```sh
herdr plugin action invoke iurysza.mosaic.show-current-space-agents
```

To show all spaces again:

```sh
herdr plugin action invoke iurysza.mosaic.show-all-agents
```

Agent titles use tab labels. Elapsed labels appear after Mosaic observes an agent finish work; switching focus does not reset them.

### Arrange panes

Focus a tab with several panes and unzoom it. To give the panes equal-width columns:

```sh
herdr plugin action invoke iurysza.mosaic.equalize
```

To try the next layout preset:

```sh
herdr plugin action invoke iurysza.mosaic.cycle
```

See [actions and keybindings](./docs/actions.md) for resize commands and bindings you can add to your Herdr config.

## Check your setup

Inspect sidebar ownership, refresh health, and config conflicts:

```sh
herdr plugin action invoke iurysza.mosaic.doctor
```

For palette choices, tint intensity, and label rules, see [settings](./docs/settings.md).

## Remove Mosaic

Restore your config before removing the plugin:

```sh
herdr plugin action invoke iurysza.mosaic.uninstall
herdr plugin uninstall iurysza.mosaic
```

## Documentation

- [Actions and keybindings](./docs/actions.md)
- [Settings](./docs/settings.md)
- [Config safety and limitations](./docs/config-safety.md)
- [Releases](./docs/releases.md)

Mosaic is [MIT licensed](./LICENSE).
