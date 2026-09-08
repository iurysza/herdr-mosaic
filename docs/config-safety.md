# Config safety and limitations

Mosaic edits selected keys in Herdr's `config.toml`. It does not regenerate the file.

- Comments, ordering, blank lines, and unrelated tables are preserved.
- Existing `rows_by_agent` entries are not created or changed.
- `herdr config check` validates the candidate before writing. Existing diagnostics do not block a write unless it introduces new ones.
- Writes use a temporary file and rename under `ctx.Lock`.
- Restore records distinguish an absent key from a key with a value and retain its original formatting.

Mosaic detects manual changes to tracked theme and sidebar values. It leaves conflicting values alone unless the command supports `--force` and you pass it. Review the conflict before forcing a write.

## What Mosaic changes

Mosaic owns the shared spaces and agents row templates, its picker binding, its agent view, and its metadata. Setup also retargets old Window Manager action bindings and records their original text for restoration. When tint is enabled, it writes the accent and selected surface colours. Depending on intensity, it also tints borders and separators.

It does not write Herdr's semantic status colours or the `text` and `subtext0` slots. Space colour does not change agent status colour.

Uninstall restores Mosaic's recorded values, not old Chromatic backups. Run the restore action before unlinking or removing the plugin.

## Limitations

- Herdr has no native collapsible group headers in the Agents panel. Mosaic's Agent Board provides them in a separate read-only popup.
- Sidebar token colours are static config. Mosaic uses pre-styled palette slots for space markers.
- Herdr sessions share `config.toml`. Use tint with one active session.
- Herdr has no theme introspection API. Set `theme_base` if Mosaic does not recognise your theme. Tint assumes a dark base.
- Model-tier labels need optional agent-provided metadata. Mosaic owns the [title and elapsed refresh](./settings.md#sidebar-refresh).
- Last-settled tracking records an observed agent completion. It is not last-focus tracking, which Mosaic does not provide.
- Mosaic runs on macOS and Linux. It uses `fcntl`, a Unix socket, and `/usr/bin/python3`.
- Window Manager, Chromatic, and Pane Layouts must not remain enabled alongside their Mosaic replacements.

State persists in `state.json`. Herdr metadata does not survive a server restart, so Mosaic republishes it during startup reconciliation.
