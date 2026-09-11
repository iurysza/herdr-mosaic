# Facts

Verified against installed `herdr 0.8.2` (protocol 20). Isolated HOME `/tmp/mosaic-checkpoint-vtL82b`. Read-only `../herdr` is `v0.9.0-dirty` and was not modified.

## Approved scope

The user chose "Keep this Mosaic-only" after reviewing the host limitations. No Herdr source, installation, or live configuration changes are authorized. Menu trimming and native button integration remain blocked rather than being replaced with lookalike controls.

## Implemented

- `toggle-agent-focus` flips all-spaces vs current-workspace filter using live `current_workspace_id`. Sort is unchanged.
- `show-all-agents` / `view all` set focus off. `show-current-space-agents` / `view current` set focus on. They are not toggles.
- CLI `sort` grammar: no args prints status; exactly one of `activity` or `spaces` sets sort. Extra or dashed arguments fail and do not write state.
- Two sorts only. `activity`: attention desc, `state_change_seq` desc, then workspace/tab/pane asc. `spaces` (default): workspace_order asc, attention desc, then tab/pane asc.
- Focus changes preserve sort. Sort changes preserve scope.
- Labels are Activity or Spaces. They identify the Mosaic projection. They do not rename or keep Herdr's native Agents sort button.
- Any Mosaic agent view disables that native button, including filter-only with no label.
- All previous action IDs remain in `herdr-plugin.toml`.
- `toggle-agent-sort` is a manifest action. Setup binds it to `prefix+shift+s` if the key is free. The action toggles only `activity` and `spaces`, and preserves focus.
- `sort-keybind-install` and `sort-keybind-remove` are CLI helpers. Mosaic records only a binding it adds, so uninstall keeps a pre-existing user binding.
- `sort` is not a manifest action.
- Published elapsed labels occupy three cells. Missing completion uses three U+2800 blank cells; short ages are padded; ages above the range cap at `99d`.
- Herdr strips ASCII padding. The existing U+2800 pad survives ingestion.
- Real Herdr rendering puts every tested title at zero-based column 9, including after clock changes. Clearing elapsed moves it to column 3.

## Blocked on Herdr 0.8.2

- No hidden/alias action API. Setup, migrate, doctor, uninstall, keybind, resize, and old show-* IDs stay listed.
- Native sort button cannot be renamed to Activity/Spaces or kept clickable while Mosaic owns the view.
- Elapsed metadata expiry still removes the column and separator. The 30-second refresh and 45-second TTL remain unchanged.
- Host panel order is unverified. There is no `agent.view.get`. `session.snapshot` has no projection field. Tests cover definition payloads, server accept, persistence, and CLI failures.

## Compatibility

Every existing ID stays invokable. Bindings and `herdr plugin action invoke` keep working. Menu trim did not happen.
