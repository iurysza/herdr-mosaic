# Config safety and limitations

Mosaic edits selected keys in Herdr's `config.toml`. It does not regenerate the file.

- Comments, ordering, blank lines, and unrelated tables are preserved.
- Existing `rows_by_agent` entries are not created or changed.
- `herdr config check` validates the candidate before writing. Existing diagnostics do not block a write unless it introduces new ones.
- Writes use a temporary file and rename under `ctx.Lock`.
- Restore records distinguish an absent key from a key with a value and retain its original formatting.

Mosaic detects manual changes to tracked theme and sidebar values. It leaves conflicting values alone unless the command supports `--force` and you pass it. Review the conflict before forcing a write.

## What Mosaic changes

Mosaic owns the shared spaces and agents row templates, its picker binding, its agent view, and its metadata. Any compatible action bindings changed during setup have their original text recorded for restoration. When tint is enabled, it writes the accent and selected surface colors. Depending on intensity, it also tints borders and separators.

It does not write Herdr's semantic status colors or the `text` and `subtext0` slots. Space color does not change agent status color.

Uninstall restores Mosaic's recorded values. Run the restore action before unlinking or removing the plugin.

## Existing data

Setup preserves existing Mosaic data. It can import compatible saved data without removing the originals. Conflicting destination files stop the import, even with `--force`; inspect the conflict instead of deleting data to get past it.

A checkout registered under a different plugin ID cannot run as Mosaic. Restore and remove that registration before registering the checkout as `iurysza.mosaic`.

## Limitations

- Herdr has no native collapsible group headers in the Agents panel. Mosaic's Agent Board provides them in a separate read-only popup.
- Sidebar token colors are static config. Mosaic uses pre-styled palette slots for space markers.
- Herdr sessions share `config.toml`. Use tint with one active session.
- Herdr has no theme introspection API. Set `theme_base` if Mosaic does not recognize your theme. Tint assumes a dark base.
- Model-tier labels need optional agent-provided metadata. Mosaic owns the [title and elapsed refresh](./settings.md#sidebar-refresh).
- Last-settled tracking records an observed agent completion. It is not last-focus tracking, which Mosaic does not provide.
- Mosaic runs on macOS and Linux. It uses `fcntl`, a Unix socket, and `/usr/bin/python3`.
- Other plugins or services must not write the same sidebar tokens, templates, or theme values while Mosaic owns them.

State persists in `state.json`. Herdr metadata does not survive a server restart, so Mosaic republishes it during startup reconciliation.
