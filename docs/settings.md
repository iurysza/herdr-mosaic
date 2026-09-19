# Settings

Optional settings live in `settings.json` inside the directory reported by:

```sh
herdr plugin config-dir iurysza.mosaic
```

With the default paths, that is `~/.config/herdr/plugins/config/iurysza.mosaic/`. State lives in `~/.local/state/herdr/plugins/iurysza.mosaic/`.

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
	"prune_stale_after": null,
	"label_identities_file": null,
	"label_identities": {}
}
```

`marker` sets the sidebar glyph. `announce` enables a toast on a space change, but Herdr's toast delivery must also be enabled. `window_title` lets Mosaic update the outer terminal title when tint changes.

## Colors and tint

The palette draws from Catppuccin, Tokyo Night, One Dark, Rosé Pine, Everforest, and Dracula.

| Name | Hex | Name | Hex |
|---|---|---|---|
| `rose` | `#eba0ac` | `peach` | `#fab387` |
| `amber` | `#e5c07b` | `sage` | `#a6d189` |
| `aqua` | `#7fd6c1` | `cyan` | `#8be9fd` |
| `steel` | `#8ca0b3` | `azure` | `#7aa2f7` |
| `lavender` | `#b4befe` | `mauve` | `#cba6f7` |
| `orchid` | `#e0a3e8` | `blush` | `#f5c2e7` |

Automatic allocation chooses colors far from those already in use. `doctor` warns about live color pairs with a distance below 80 in the plugin's color metric. The advanced `repalette --dry-run` command previews snapping non-palette colors to the current palette. Without `--dry-run`, it applies those changes and resolves close pairs, which can change manual colors. The dry run does not preview the close-pair reallocations.

Colors accept palette names, `#rrggbb`, or `#rgb`. Tint uses a custom hex value exactly for the accent. Its sidebar marker and agent titles use the nearest palette slot because Herdr's sidebar colors are static config. Use the [direct `set-color` command](./actions.md#set-an-exact-color) to set a color without opening the picker.

| Intensity | Surface blend | Borders and separators |
|---|---|---|
| `subtle` | 8–20% | Untinted |
| `medium` | 14–36% | Tinted |
| `bold` | 22–52% | Tinted |

`medium` is the default. Surfaces blend the theme's dark base toward the space color, subject to luminance ceilings. `theme_base` defaults to `auto`; set a hex value if Mosaic does not recognize your theme. `blend` overrides individual blend fractions. `tint_overlays` overrides the intensity preset's border setting when set to `true` or `false`.

```sh
/path/to/herdr-mosaic/dist/mosaic tint-intensity subtle
/path/to/herdr-mosaic/dist/mosaic tint-preview
```

Setting an intensity does not enable tint. The existing `intensity-subtle`, `intensity-medium`, `intensity-bold`, and `preview-tint` action IDs remain available. Use the direct CLI to see swatches in your terminal.

## Stale-agent pruning

`prune_stale_after` controls which settled agents can be selected in the **Prune stale agent sessions** popup. It is unset by default, so Mosaic never assumes an arbitrary cleanup period. Set it in the popup with `t`, or add a positive whole duration to `settings.json`:

```json
{
	"prune_stale_after": "2d"
}
```

Units are `s`, `m`, `h`, `d`, and `w`. Mosaic lists idle and done agents by observed settlement age. An agent first found already idle has no reliable age, remains marked `untracked`, and cannot be selected. The popup protects the agent focused before it opens and confirms every close.

## Label rules

A version-1 `identities.json` file can map space names to colors:

```json
{
	"version": 1,
	"identities": {
		"Website": "azure",
		"API": "sage"
	}
}
```

Put it in Mosaic's config directory or set `label_identities_file` to another path. `HERDR_LABEL_IDENTITIES_FILE` takes precedence over that setting. Inline `label_identities` entries override file rules.

Rules apply during reconciliation. A color chosen manually in the picker takes precedence.

## Sidebar refresh

Mosaic publishes tab titles in the space's color. If a tab has no label, it uses the stripped terminal title, agent name, display name, agent kind, or pane ID, in that order. Each update clears the other color slots. Titles have no expiry, so a failed refresh does not erase the last published name.

Elapsed labels show time since launch or the latest observed `working` to `idle` or `done` transition. Focus changes do not reset them. Mosaic uses receipt time for launch because Herdr's detect and status events have no timestamp.

Setup starts a detached Mosaic worker. Herdr's startup hook starts it again after a server restart. A file lock permits one worker per socket generation. It refreshes every 30 seconds and expires elapsed labels after 45 seconds without a successful update. Relevant tab and agent events also refresh labels and restart a missing worker.

The worker exits when its server socket disappears or changes, the plugin is disabled or unlinked, or the sidebar is uninstalled. It checks these conditions each round, so exit can take up to one refresh interval plus an in-flight RPC. It does not install launchd or systemd units. `doctor` reports the last successful round; errors go to `refresh.log` in the plugin state directory. To restart a failed worker manually, run `dist/mosaic reconcile` from the installed checkout.

Mosaic owns the `agent-sidebar-title` and `agent-elapsed` metadata sources. Do not run another publisher for those tokens at the same time.

Model-tier labels remain optional. Themed Pi supplies `$themed_model_tier`; Mosaic never writes or clears that token.

The agents row has 15 tokens: the state icon, `$elapsed`, twelve colored `$title_*` slots, and `$themed_model_tier`. Unused title slots remain in the template.

Existing `rows_by_agent` entries are left unchanged. Herdr uses them instead of the shared agents row for matching agents, so those agents may not show Mosaic's template.
