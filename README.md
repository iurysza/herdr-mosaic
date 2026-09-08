# Herdr Window Manager

Per-space colour identity, the current spaces and agents sidebar templates,
grouped agent view, optional chrome tint, and tmux-style pane layouts.

Plugin id: `iurysza.window-manager`.

Herdr's semantic status colours (`red`, `green`, `yellow`, `peach`) and its
`text` / `subtext0` slots are **never written**. A blue Website Space still shows
a red blocked Agent.

Title and elapsed labels come from `herdr-agent-elapsed`. `$themed_model_tier`
comes from themed Pi. This plugin does not publish those tokens. Coloured title
slots stay in the agent row even when they are blank at startup.

---

## Install

From GitHub:

```sh
herdr plugin install iurysza/herdr-window-manager
```

Local checkout (after you have approved cutover — see [docs/cutover.md](docs/cutover.md)):

```sh
herdr plugin link /path/to/herdr-window-manager
herdr plugin action invoke iurysza.window-manager.migrate
herdr plugin action invoke iurysza.window-manager.install
```

`migrate` copies Chromatic identities and settings into this plugin's directories
and **ignores** stale Chromatic config backups. `install` writes the owned
sidebar templates, binds the picker key if free, and installs the agent view
(keeping a migrated `view_mode` of `current` if Chromatic had one).
`install --dry-run` only previews migrate; it does not write sidebar, keybind,
or agent view.

Do **not** run Chromatic `install` or `uninstall` against a config that already
has the elapsed/title agent row.

To enable the optional chrome tint:

```sh
herdr plugin action invoke iurysza.window-manager.tint-enable
```

```sh
herdr plugin action invoke iurysza.window-manager.doctor
```

### Uninstalling

Run `uninstall` first to restore this plugin's ownership baseline, then unlink:

```sh
herdr plugin action invoke iurysza.window-manager.uninstall
herdr plugin unlink iurysza.window-manager
```

That restores keys this plugin snapshotted, not Chromatic's older backups.

### Requirements

| | |
|---|---|
| Herdr | 0.8.0 or newer — the version identity/view calls were verified against |
| Python | 3.6 or newer at `/usr/bin/python3` |
| Platforms | macOS and Linux. Not Windows: it uses `fcntl` and a unix socket |

---

## What you get

**Spaces sidebar** — a coloured dot sits between the state icon and the Space
name. Branch/git rows are preserved:

```
■  Website          <- colour slot
   main
■  API
   feature/auth
```

**Agents sidebar** — 15 tokens, under Herdr's 16-token cap. No space dots:

```
state_icon  $elapsed  12 × $title_*  $themed_model_tier
```

**Agent grouping** — a plugin-owned Agent view sorted by
`workspace → tab → pane`. Detection, status, notifications and attention counts
are untouched.

**Space switch tint** (optional) — `accent` becomes the Space colour, and
`panel_bg` / `surface_dim` / `surface0` / `surface1` are your theme's dark base
blended toward it.

**Pane layouts** — equalize, cycle presets, and 2% directional resize. Equalize
and cycle move panes through a staging tab and recover them if reshape fails.
Unzoom first.

---

## The palette

Twelve pastel hues drawn from Catppuccin, Tokyo Night, One Dark, Rosé Pine,
Everforest and Dracula:

| | | | |
|---|---|---|---|
| `rose` `#eba0ac` | `peach` `#fab387` | `amber` `#e5c07b` | `sage` `#a6d189` |
| `aqua` `#7fd6c1` | `cyan` `#8be9fd` | `steel` `#8ca0b3` | `azure` `#7aa2f7` |
| `lavender` `#b4befe` | `mauve` `#cba6f7` | `orchid` `#e0a3e8` | `blush` `#f5c2e7` |

Allocation maximises perceptual distance from colours already in use. `doctor`
warns about live pairs closer than 80, and `repalette` reassigns.

Portable **label → colour** rules (version-1 JSON, same shape as
`chromatic-spaces-identities.json`) are applied on reconcile unless a Space was
set manually in the picker.

---

## Tint intensity

| Preset | Surfaces | Borders/separators |
|---|---|---|
| `subtle` | 8–20% | untinted |
| `medium` *(default)* | 14–36% | tinted |
| `bold` | 22–52% | tinted |

```sh
herdr plugin action invoke iurysza.window-manager.intensity-subtle
herdr plugin action invoke iurysza.window-manager.intensity-medium
herdr plugin action invoke iurysza.window-manager.intensity-bold
herdr plugin action invoke iurysza.window-manager.preview-tint
```

---

## Actions

| Action | Purpose |
|---|---|
| `migrate` | Import Chromatic/layouts identities and settings; never apply old config backups |
| `install` | Migrate + sidebar templates + bind picker + agent view + reconcile |
| `set-identity` | Colour picker for the current Space |
| `auto-assign` | Default colour for Spaces without an identity |
| `tint-enable` / `tint-disable` | Chrome tint on/off |
| `intensity-subtle` / `-medium` / `-bold` | Tint strength |
| `preview-tint` | Swatches of all three intensities |
| `theme-restore` | Restore pre-plugin theme values |
| `show-all-agents` / `show-current-space-agents` | Agent view scope |
| `open-agent-board` | Collapsible Agent Board popup |
| `equalize` / `cycle` / `resize-*` | Pane layouts |
| `bind-picker-key` / `unbind-picker-key` | Picker keybinding |
| `doctor` | Diagnostics |
| `uninstall` | Restore this plugin's snapshotted keys |

Colours accept a palette name or `#rrggbb` / `#rgb`. A custom hex is used exactly
for the chrome tint; its sidebar dot borrows the nearest palette slot.

Default picker bind is **`prefix+i`**. If that key is already Command Palette,
leave it alone and bind another key.

Example layout binds:

```toml
[[keys.command]]
key = "ctrl+backslash"
type = "plugin_action"
command = "iurysza.window-manager.equalize"

[[keys.command]]
key = "prefix+space"
type = "plugin_action"
command = "iurysza.window-manager.cycle"
```

---

## Settings

Optional `settings.json` in
`herdr plugin config-dir iurysza.window-manager`:

```json
{
  "marker": "■",
  "intensity": "medium",
  "theme_base": "auto",
  "blend": {},
  "tint_overlays": null,
  "announce": false,
  "window_title": true,
  "window_title_suffix": " — Herdr",
  "label_identities_file": null,
  "label_identities": {}
}
```

State lives at `~/.local/state/herdr/plugins/iurysza.window-manager/`.

---

## Config safety

`config.toml` is edited **surgically**, never regenerated:

1. Comments, ordering, blank lines and unrelated tables survive.
2. Only keys the plugin owns are rewritten. Existing `rows_by_agent` entries are
   not created or modified.
3. The candidate is validated by **`herdr config check`** (baseline-aware).
4. Write is `temp file + rename`.
5. Restoration distinguishes absent from present-with-value.

Manual edits of owned keys are refused unless you pass `--force`.

---

## Known limitations

1. No native collapsible group headers in the Agents panel. Use `open-agent-board`.
2. No per-Space token colour in the sidebar. Spaces use static `$sd_*` slots.
3. `config.toml` is global across sessions. Tint with one active session.
4. No theme introspection API. Set `theme_base` if your theme is unknown.
5. macOS/Linux only. Interpreter is `/usr/bin/python3`.
6. Last-focus is not included.
7. Two writers still fight if Chromatic remains linked after cutover.

---

## Development

```sh
python3 -m unittest discover -s tests -t tests
```

Stdlib only. CI runs that command on Linux with a pinned Herdr CLI for
`herdr config check`. See [docs/releases.md](docs/releases.md),
[AGENTS.md](AGENTS.md), [docs/provenance.md](docs/provenance.md),
and [docs/cutover.md](docs/cutover.md).

---

## Licence

MIT — see [LICENSE](LICENSE). Chromatic Spaces portions remain Copyright (c) 2026
Jack Dalton.
