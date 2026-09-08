# Mosaic

![Mosaic](./assets/mosaic-wordmark.png)

Color your Herdr spaces, group agents, and arrange panes.

Mosaic is experimental. Back up Herdr's config before you install it.

## Install

You need Herdr 0.8.0 or newer and Python 3.6 or newer at `/usr/bin/python3`. Mosaic runs on macOS and Linux with the Python standard library only. It publishes agent titles and elapsed labels and needs no extra service. Model-tier labels are optional.

Install from GitHub, then run setup:

```sh
herdr plugin install iurysza/herdr-mosaic
herdr plugin action invoke iurysza.mosaic.install
```

Do not run another plugin or service that writes Herdr sidebar templates or theme values while Mosaic is installed. Run `herdr plugin action invoke iurysza.mosaic.uninstall` before you remove it.

## Documentation

- [Actions and keybindings](./docs/actions.md)
- [Settings](./docs/settings.md)
- [Config safety and limitations](./docs/config-safety.md)
- [Releases](./docs/releases.md)

Mosaic is [MIT licensed](./LICENSE).
