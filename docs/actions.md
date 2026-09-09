# Actions and keybindings

Mosaic colors spaces and arranges existing panes. Herdr owns workspace creation, navigation, splits, and moves. A space in the sidebar is a workspace in Herdr's CLI.

Mosaic's plugin ID is `iurysza.mosaic`. Invoke an action with its full ID:

```sh
herdr plugin action invoke iurysza.mosaic.set-identity
```

Herdr has a flat action list, not nested task menus. The sections below organize the documentation only. Every existing action ID and binding remains supported; no alias actions are added.

Herdr resolves action context from the focused workspace, which may differ from the calling pane's workspace. `plugin action invoke` does not accept arbitrary command arguments. Use the direct CLI for a target workspace, an exact color, or command flags.

## Choose a space color

| Action suffix | Menu title | Effect |
|---|---|---|
| `set-identity` | Mosaic: Choose space color | Open the palette picker for the current space, including custom hex input |

`prefix+i` opens the same picker if setup added that binding. The color applies to the space marker and agent titles. Window tint is optional and starts off.

## Set an exact color

Direct commands run through `/usr/bin/python3 /path/to/herdr-mosaic/src/main.py`. There is no separate `mosaic` executable.

```sh
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py set-color --workspace w1 --color '#123456'
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py set-color --workspace w1 --color azure
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py list-colors
```

Colors accept a palette name, `#rgb`, or `#rrggbb`. Quote hex values in the shell. Tint uses the exact color for the accent; surfaces blend it with the theme base. Space markers and agent titles use the nearest palette slot because their colors are static Herdr config.

Without `--workspace`, the setter uses the action context or focused workspace. Without a color, it keeps the existing color or allocates one if missing. The existing flags and parsing behavior are unchanged.

## Tint the window

| Action suffix | Effect |
|---|---|
| `tint-enable` | Enable tint using the focused space's color |
| `tint-disable` | Stop tinting and restore recorded theme values, preserving external edits |
| `intensity-subtle`, `intensity-medium`, `intensity-bold` | Set tint strength without enabling tint |

Use tint with one active Herdr session because sessions share the config file. For direct control:

```sh
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py tint-enable
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py tint-intensity subtle
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py tint-preview
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py tint-disable
```

`tint-intensity` without an argument prints the current setting. See [settings](./settings.md) for blend and border overrides.

## Choose the agent view

| Action suffix | Effect |
|---|---|
| `show-current-space-agents` | Show agents in the focused space; follow space changes |
| `show-all-agents` | Show all agents, ordered by space, tab, and pane |
| `open-agent-board` | Open collapsible space groups; select an agent to focus it |

These actions change the view, not agent status. The board is a separate popup, not native sidebar group headers.

Direct equivalents are `main.py agents current`, `main.py agents all`, and `main.py agent-board`.

## Arrange panes

| Action suffix | Menu title | Effect |
|---|---|---|
| `equalize` | Mosaic: Arrange even columns | Arrange existing panes as equal-width columns |
| `cycle` | Mosaic: Next pane layout | Try the next distinct layout preset |
| `resize-left`, `resize-right`, `resize-up`, `resize-down` | Mosaic: Resize pane left, right, up, or down | Resize the current pane split by 2% |

`equalize` does not balance the existing layout tree. It replaces the arrangement with columns. `cycle` visits columns, rows, main-left, main-top, and tiled layouts, skipping duplicates for the current pane count. Main layouts use the first pane in layout order, not necessarily the focused pane.

```sh
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py arrange-columns
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py next-layout
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py layout resize-left
```

Layout commands use the calling pane's `HERDR_PANE_ID` when present, then the invocation context. Unzoom before arranging. Mosaic temporarily moves panes through a staging tab without restarting their processes. If a reshape fails, it attempts to recover the panes and reports where any remaining panes are.

There is no direct named-preset setter in this release. `next-layout` cycles the existing presets.

### Workspace operations, splits, and moves

Use Herdr directly instead of Mosaic wrappers:

```sh
herdr workspace create --label Website --no-focus
herdr workspace rename w1 Website
herdr workspace focus w1
herdr pane split --pane w1:p1 --direction right --no-focus
herdr pane split --pane w1:p1 --direction down --no-focus
herdr pane move w1:p2 --tab w1:t2 --split right --no-focus
herdr pane resize --pane w1:p1 --direction left --amount 0.02
```

IDs above are examples. Use `herdr workspace list`, `herdr tab list`, and `herdr pane list` to find yours. Herdr also provides workspace and tab `close` commands. Splits support `right` and `down`; resize supports all four directions. Use each command's `--help` for its flags.

### Layout keybindings

Add these bindings only if the keys are free:

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

## Advanced setup and maintenance

These existing actions remain callable and visible in Herdr's flat list. They are not everyday controls.

| Action suffix | Direct command | Effect |
|---|---|---|
| `install` | `install` | Set up sidebar templates, the picker binding, the agent view, and title and elapsed refresh |
| `uninstall` | `uninstall` | Restore recorded config before removing Mosaic |
| `doctor` | `doctor` | Print diagnostics |
| `migrate` | `migrate` | Import compatible saved state without replacing existing Mosaic data |
| `auto-assign` | `assign-colors` | Assign colors to spaces without an assignment |
| `preview-tint` | `tint-preview` | Print swatches for all three intensities |
| `theme-restore` | `theme-restore` | Same as `tint-disable`, including stopping tint |
| `bind-picker-key` | `keybind-install` | Bind `prefix+i` if free, or retain the existing picker binding |
| `unbind-picker-key` | `keybind-remove` | Remove the picker action binding |

Text printed by actions is available in Herdr's plugin command logs. For diagnostics and swatches in your terminal, use the direct CLI.

```sh
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py doctor
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py keybind-install --key prefix+shift+i
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py repalette --dry-run
/usr/bin/python3 /path/to/herdr-mosaic/src/main.py install --dry-run
```

The picker key installer preserves an existing picker binding rather than adding another. `assign-colors --force` removes the focused space's assignment before automatic allocation. `repalette` snaps non-palette colors to the current palette and then resolves close pairs; it can change manual colors. Its dry run previews the snaps, not the later close-pair reallocations.

`install --dry-run` previews only saved-state import. It does not preview or write sidebar templates, keybindings, or the agent view, and it does not start a refresh worker. Restore and tint commands retain their existing conflict handling and `--force` behavior. See [config safety](./config-safety.md).

Other advanced direct commands remain available: `marker`, `announce`, `view-clear`, and `state`.

## Internal hooks and recovery

`reconcile`, `event`, `sidebar-install`, `sidebar-remove`, `picker`, `board`, `elapsed-publish`, and `refresh-worker` support startup, popup entrypoints, publication, and cleanup. They are not new menu actions.

For a failed refresh worker, use `main.py reconcile` as documented in [sidebar refresh](./settings.md#sidebar-refresh). `refresh-worker` requires the socket generation supplied by startup; do not start another publisher manually.

## CLI compatibility

Preferred names are aliases of existing commands. They use the same handlers, arguments, exit codes, locking, migration guards, and refresh behavior.

| Preferred direct command | Existing command, still supported |
|---|---|
| `pick-color` | `set-identity` |
| `set-color` | `apply-identity` |
| `list-colors` | `list` |
| `assign-colors` | `auto-assign` |
| `tint-intensity` | `intensity` |
| `tint-preview` | `preview` |
| `agents` | `view` |
| `agent-board` | `board-open` |
| `arrange-columns` | `layout equalize` |
| `next-layout` | `layout cycle` |

These aliases are CLI commands only, not action IDs. Existing command names, picker environment variables, manifest entrypoints, and bindings are unchanged. No binding migration is required. Titles and help text are for people; callers should use IDs and command names.

`main.py --help` groups commands by task and lists compatibility aliases. `--help` or `-h` anywhere in an invocation prints help without running the command.
