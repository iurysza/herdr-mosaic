# Actions and keybindings

Mosaic's plugin ID is `iurysza.mosaic`. Invoke an action with:

```sh
herdr plugin action invoke iurysza.mosaic.set-identity
```

Herdr uses the focused workspace for action context, which may differ from the calling pane's workspace.

| Action | Purpose |
|---|---|
| `install` | Set up sidebar templates, title and elapsed refresh, the picker key, and the agent view |
| `migrate` | Import compatible saved state without replacing existing Mosaic data |
| `set-identity` | Open the color picker for the current space |
| `auto-assign` | Assign colors to spaces without an identity |
| `tint-enable`, `tint-disable` | Enable tint, or disable it and restore the previous theme values |
| `intensity-subtle`, `intensity-medium`, `intensity-bold` | Set tint strength |
| `preview-tint` | Print swatches for all three intensities |
| `theme-restore` | Restore pre-plugin theme values |
| `show-all-agents`, `show-current-space-agents` | Choose the agent view's scope |
| `open-agent-board` | Open a read-only popup with collapsible agent groups |
| `equalize` | Arrange panes as equal-width columns |
| `cycle` | Cycle pane layout presets |
| `resize-left`, `resize-down`, `resize-up`, `resize-right` | Resize the current pane by 2% |
| `bind-picker-key`, `unbind-picker-key` | Add or remove the picker binding |
| `doctor` | Print diagnostics |
| `uninstall` | Restore config before removing the plugin |

## Keybindings

The default picker key is `prefix+i`. Mosaic leaves it alone if another command already uses it. It also keeps an existing binding for the picker instead of adding a second one.

To bind a different picker key from a checkout:

```sh
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py keybind-install --key prefix+shift+i
```

Add layout bindings to your Herdr config if the keys are free:

```toml
[[keys.command]]
key = "ctrl+backslash"
type = "plugin_action"
command = "iurysza.mosaic.equalize"

[[keys.command]]
key = "prefix+space"
type = "plugin_action"
command = "iurysza.mosaic.cycle"
```

Unzoom before equalizing or cycling. These actions temporarily move panes through a staging tab. If a reshape fails, Mosaic attempts to recover the panes and reports where any remaining panes are.

## Direct commands

Some commands are available through `src/main.py` rather than named Herdr actions:

```sh
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py --help
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py list
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py repalette
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py install --dry-run
```

`repalette` reassigns colors. `install --dry-run` previews only saved-state import. It does not preview or write sidebar templates, keybindings, or the agent view, and it does not start a refresh worker.
