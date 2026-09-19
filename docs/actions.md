# Actions and keybindings

Mosaic colors spaces, arranges panes, and moves panes between workspaces. Herdr owns workspace creation and navigation. A space in the sidebar is a workspace in Herdr's CLI.

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

Direct commands run through `/path/to/herdr-mosaic/dist/mosaic`. Build that binary with `bun run build` from a checkout.

```sh
/path/to/herdr-mosaic/dist/mosaic set-color --workspace w1 --color '#123456'
/path/to/herdr-mosaic/dist/mosaic set-color --workspace w1 --color azure
/path/to/herdr-mosaic/dist/mosaic list-colors
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
/path/to/herdr-mosaic/dist/mosaic tint-enable
/path/to/herdr-mosaic/dist/mosaic tint-intensity subtle
/path/to/herdr-mosaic/dist/mosaic tint-preview
/path/to/herdr-mosaic/dist/mosaic tint-disable
```

`tint-intensity` without an argument prints the current setting. See [settings](./settings.md) for blend and border overrides.

## Choose the agent view

| Action suffix | Effect |
|---|---|
| `toggle-agent-focus` | Toggle all spaces and the focused space. The filter follows space changes |
| `toggle-agent-sort` | Toggle Activity and Spaces. Focus is unchanged |
| `show-current-space-agents` | Set focus on. Kept for existing bindings and callers |
| `show-all-agents` | Set focus off. Kept for existing bindings and callers |
| `open-agent-board` | Open collapsible space groups; select an agent to focus it |

Setup binds `toggle-agent-sort` to `prefix+shift+s` when the key is free. On this machine, press Ctrl+A, then Shift+S. It never replaces an occupied key.

These actions change the view, not agent status. The board is a separate popup, not native sidebar group headers. Herdr 0.8.2 cannot hide actions, so retained maintenance and compatibility actions remain in the flat action list.

Use `dist/mosaic agents current`, `dist/mosaic agents all`, or `dist/mosaic agent-board` directly. Use `dist/mosaic sort activity` or `dist/mosaic sort spaces` to set a sort. The focus and sort settings persist independently. There is no third sort.

## Cycle idle agents and prune stale sessions

| Action suffix | Effect |
|---|---|
| `next-idle-agent` | Focus the next idle or done agent, ordered by most recent observed completion and wrapping after the oldest. |
| `prune-stale-agents` | Open the popup for reviewing and confirming closure of stale idle and done agent panes. |

Setup binds `next-idle-agent` to `prefix+.` and `prune-stale-agents` to `prefix+alt+x` when each key is free. Neither binding replaces an occupied key.

The pruner lists settled agents oldest first. Use `t` to set its file-backed stale threshold, Space to select eligible rows, then `x` to review and `x` again to confirm. It protects the focused agent that opened the popup, excludes working, blocked, unknown, and untracked agents, and rereads live state before every close. A close ends the agent process and pane. It does not delete agent session history.

Use `dist/mosaic next-idle-agent` or `dist/mosaic prune-stale-agents` directly. The popup command itself is internal.

## Arrange panes

| Action suffix | Menu title | Effect |
|---|---|---|
| `equalize` | Mosaic: Arrange even columns | Arrange existing panes as equal-width columns |
| `cycle` | Mosaic: Next pane layout | Try the next distinct layout preset |
| `resize-left`, `resize-right`, `resize-up`, `resize-down` | Mosaic: Resize pane left, right, up, or down | Resize the current pane split by 2% |

`equalize` does not balance the existing layout tree. It replaces the arrangement with columns. `cycle` visits columns, rows, main-left, main-top, and tiled layouts, skipping duplicates for the current pane count. Main layouts use the first pane in layout order, not necessarily the focused pane.

```sh
/path/to/herdr-mosaic/dist/mosaic arrange-columns
/path/to/herdr-mosaic/dist/mosaic next-layout
/path/to/herdr-mosaic/dist/mosaic layout resize-left
```

Layout commands use the calling pane's `HERDR_PANE_ID` when present, then the invocation context. Unzoom before arranging. Mosaic temporarily moves panes through a staging tab without restarting their processes. If a reshape fails, it attempts to recover the panes and reports where any remaining panes are.

There is no direct named-preset setter in this release. `next-layout` cycles the existing presets.

### Move a pane

| Action suffix | Effect |
|---|---|
| `move-pane` | Pick the focused pane, then confirm a destination and placement |
| `promote-pane` | Move the focused pane to a new tab in its current workspace |

Setup binds `move-pane` to `prefix+/` and `promote-pane` to `prefix+shift+m` only when those keys are free. With the standard prefix, press Ctrl+A then `/` or Shift+M. Mosaic never replaces an occupied binding.

1. Focus the source pane and press `prefix+/`. Mosaic stores the selection and shows a short confirmation.
2. Navigate normally to the destination pane, including another workspace.
3. Press `prefix+/` again. The confirmation popup shows the source and destination.
4. Press `s` to move the source into a split on the right of the destination. Press `t` to make it a new tab in the destination workspace. Mosaic does not use Enter because terminals commonly collapse Shift+Enter into it.
5. Press Esc or `q` to cancel and clear the selection.

A source that no longer exists is cleared when the action is next invoked. Mosaic refuses a split when the source and destination are the same pane, but the new-tab choice still works. A valid selection has no timeout.

Use `promote-pane` for the former one-step promotion behaviour. It does not clear a separately selected pane move.

For scripted operations, use Herdr directly:

```sh
herdr workspace create --label Website --no-focus
herdr workspace rename w1 Website
herdr workspace focus w1
herdr pane split --pane w1:p1 --direction right --no-focus
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
| — | `sort-keybind-install` | Bind `prefix+shift+s` if free |
| — | `sort-keybind-remove` | Remove Mosaic's sorting shortcut |
| — | `idle-keybind-install` | Bind `prefix+.` if free |
| — | `idle-keybind-remove` | Remove Mosaic's idle-agent shortcut |
| — | `prune-keybind-install` | Bind `prefix+alt+x` if free |
| — | `prune-keybind-remove` | Remove Mosaic's stale-agent shortcut |
| — | `pane-move-keybind-install` | Bind `prefix+/` if free |
| — | `pane-move-keybind-remove` | Remove Mosaic's pane-move shortcut |
| — | `promote-pane-keybind-install` | Bind `prefix+shift+m` if free |
| — | `promote-pane-keybind-remove` | Remove Mosaic's pane-promotion shortcut |

Text printed by actions is available in Herdr's plugin command logs. For diagnostics and swatches in your terminal, use the direct CLI.

```sh
/path/to/herdr-mosaic/dist/mosaic doctor
/path/to/herdr-mosaic/dist/mosaic keybind-install --key prefix+shift+i
/path/to/herdr-mosaic/dist/mosaic repalette --dry-run
/path/to/herdr-mosaic/dist/mosaic install --dry-run
```

The picker key installer preserves an existing picker binding rather than adding another. `assign-colors --force` removes the focused space's assignment before automatic allocation. `repalette` snaps non-palette colors to the current palette and then resolves close pairs; it can change manual colors. Its dry run previews the snaps, not the later close-pair reallocations.

`install --dry-run` previews only saved-state import. It does not preview or write sidebar templates, keybindings, or the agent view, and it does not start a refresh worker. Restore and tint commands retain their existing conflict handling and `--force` behavior. See [config safety](./config-safety.md).

Other advanced direct commands remain available: `marker`, `announce`, `view-clear`, and `state`.

## Internal hooks and recovery

`reconcile`, `event`, `sidebar-install`, `sidebar-remove`, `picker`, `board`, `elapsed-publish`, and `refresh-worker` support startup, popup entrypoints, publication, and cleanup. They are not new menu actions.

For a failed refresh worker, use `dist/mosaic reconcile` as documented in [sidebar refresh](./settings.md#sidebar-refresh). `refresh-worker` requires the socket generation supplied by startup; do not start another publisher manually.

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

`dist/mosaic --help` groups commands by task and lists compatibility aliases. `--help` or `-h` anywhere in an invocation prints help without running the command.
