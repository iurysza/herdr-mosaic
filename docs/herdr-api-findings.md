# Herdr 0.8.0 plugin API — verified findings

Everything below was confirmed against the installed binary
(`herdr 0.8.0`, protocol 19, macOS) by `herdr api schema --json`,
`herdr --default-config`, `herdr config check` probing, and live socket calls.
Where the installed binary disagreed with an assumption, the binary won.

## Discovery gotcha

`herdr --help` does **not** list `plugin` among its command groups, but
`herdr plugin` exists and is fully featured. Don't conclude a subsystem is
missing from top-level help alone.

## Socket API

`herdr api` only exposes `snapshot` and `schema` — there is **no** `herdr api call`.
Any call without a CLI wrapper must go over the socket directly:

- transport: unix socket at `$HERDR_SOCKET_PATH`, newline-delimited JSON
- request: `{"id": "...", "method": "...", "params": {...}}` (both required)
- reply: `{"id", "result"}` or `{"id", "error": {"code", "message"}}`
- the server may interleave unsolicited events — match on `id`

Calls this plugin relies on:

| Method | Notes |
|---|---|
| `workspace.report_metadata` | `{workspace_id, source, tokens}`; ≤16 tokens, names `^[A-Za-z0-9_-]{1,32}$`, values string-or-null (null clears); optional `ttl_ms` (≤86400000), `seq` |
| `pane.report_metadata` | same plus `title`, `display_agent`, `state_labels`, and `clear_*` flags |
| `agent.view.set` | `{source, label, sort[], filter?}` → `{active, source, label}` |
| `agent.view.clear` | `{source}` → `{active: false}` |
| `server.reload_config` | → `{status: "applied", diagnostics: []}`; logged `changes_ui=true` |
| `client.window_title.set` / `.clear` | `{title}` |
| `plugin.pane.open` | `{plugin_id, entrypoint, placement?, focus?, env?}` |
| `popup.close` | errors `popup_not_open` when none is open |
| `pane.report_agent` / `pane.release_agent` | lets a plugin declare a pane hosts an agent (useful for testing hooks) |

`agent.view` sort fields: `workspace_order`, `tab_order`, `pane_order`,
`attention`, `status`, `agent`, `seen`, `state_change_seq`, or `{token: "..."}`.
Filter ops: `all`, `any`, `not`, `eq`, `in`, `exists` — **no** `substring`/`regex`
(those consts belong to `pane.wait_for_output`). Filter values may be
`{context: "current_workspace_id"|"current_tab_id"}`, resolved live by the server.

The view is a **sidebar projection**: `agent.list` still returns every agent
regardless of an active view.

There is **no** `agent.view.get` and **no** theme-introspection call.

## Manifest

`[[events]] on` uses **dotted** names (`workspace.focused`), while socket event
payloads use snake_case (`workspace_focused`). Unknown names are non-fatal —
they surface in `plugin.list[].warnings`, which makes the manifest self-validating.

Valid event names (probed by linking a manifest with candidates and reading the
warnings):

```
workspace.created  workspace.focused  workspace.renamed  workspace.closed
workspace.updated  workspace.moved    workspace.reordered
pane.created  pane.moved  pane.closed  pane.exited  pane.focused
pane.agent_detected  pane.agent_status_changed
tab.created  tab.closed  tab.focused  tab.moved  tab.renamed
worktree.created  worktree.opened  worktree.removed
```

Rejected: `layout.updated`, `pane.output_changed`, `pane.updated`,
`workspace.metadata_updated`, and any snake_case form.

Other manifest facts:

- `width`/`height` on `[[panes]]` are **popup-only** — otherwise linking fails with
  `invalid_plugin_pane_size`.
- placements: `overlay` (default), `popup`, `split`, `tab`, `zoomed`.
- action `contexts`: `global`, `workspace`, `tab`, `pane`, `selection`.
- omitting `platforms` produces a warning.
- `[[build]]` is skipped by `plugin link` (local dev), run by `plugin install`.

## Runtime environment

`HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`, `HERDR_TAB_ID`,
`HERDR_WORKSPACE_ID`, `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_ROOT`,
`HERDR_PLUGIN_CONFIG_DIR`, `HERDR_PLUGIN_STATE_DIR`, `HERDR_PLUGIN_ENTRYPOINT_ID`,
`HERDR_PLUGIN_ACTION_ID`, `HERDR_PLUGIN_EVENT`, `HERDR_PLUGIN_EVENT_JSON`,
`HERDR_PLUGIN_CONTEXT_JSON`.

Two traps:

- **Plugin commands get a minimal `PATH`.** Invoke interpreters and tools by
  absolute path (or prepend `PATH` yourself).
- **`plugin action invoke` resolves context from the focused workspace**, not from
  the calling pane's `HERDR_*` env.

`HERDR_PLUGIN_STATE_DIR` resolves to
`~/.local/state/herdr/plugins/<plugin_id>/`. Pane commands run with the pane's
cwd, not the plugin root — hence `sh -c 'exec … "$HERDR_PLUGIN_ROOT/…"'`.

## Config

Path from `HERDR_CONFIG_PATH`, else `~/.config/herdr/config.toml`.
`herdr config check` honours `HERDR_CONFIG_PATH`, which makes it a perfect
validator for a candidate file before committing.

**Exit codes:** `0` = clean; `1` for parse errors, duplicate tables, unknown
config keys, *and* unknown sidebar tokens. Because an unknown key alone is
enough for exit 1, a validator must be **baseline-aware**: compare the candidate's
diagnostics against the current file's, and only reject newly introduced ones.
Otherwise a user whose config already warns can never be patched.

Valid `[theme.custom]` tokens (probed exhaustively — 16 total):

```
accent  panel_bg  text  subtext0
surface_dim  surface0  surface1  overlay0  overlay1
red  green  yellow  peach  blue  teal  mauve
```

Rejected: `base`, `crust`, `mantle`, `overlay2`, `subtext1`, `surface2`,
`cyan`, `magenta`, `orange`, `border`, `panel_border`, `selection`, `cursor`,
`fg`/`bg`, `lavender`, `sapphire`, `sky`, `pink`, `flamingo`, `rosewater`,
`maroon`, and every `*_bg`/`*_fg` variant tried.

Docs describe `mauve, green, yellow, red, blue, teal, peach` as "semantic and
accent colours", so this plugin writes none of them — only `accent`, `panel_bg`,
`surface_dim`, `surface0`, `surface1`, plus `ui.accent`.

Sidebar rows: `ui.sidebar.spaces.rows` and `ui.sidebar.agents.rows` are arrays of
token rows (≤16 rows, ≤16 tokens each). Built-ins for spaces are `state_icon`,
`state_text`, `workspace`, `branch`, `git_status`; for agents also `tab`, `pane`,
`agent`, `terminal_title`, `terminal_title_stripped`. Metadata tokens use `$name`.
Inline styling is `{ token = "workspace", fg = "#89b4fa", bold = true, dim = false }`
— **static config only**, so a token cannot take its colour from a metadata value.

A custom token inside a style table **must keep its `$`**: `{ token = "$sd_blue" }`
validates, while `{ token = "sd_blue" }` fails with *"unknown sidebar token
`sd_blue`; custom tokens must start with `$`"*. Bare string tokens in a row use
`$name` too. Rows accept at most 16 tokens, so a per-slot styled palette is
workable but bounded — 8 slots plus `state_icon`/`workspace`/`tab` validates.

This is what makes per-Space colour possible at all: give every palette slot its
own pre-styled token, then publish a value on only the matching one.

`ui.sidebar.agents.rows_by_agent.<agent>` **fully replaces** `rows` for that
agent, so any existing entry must be patched alongside `rows`.

## Sessions

`herdr session list --json` reports each session's `running`, `session_dir` and
`socket_path`. Session dirs hold `session.json`, logs and a socket but **no
config.toml** — configuration is **global across sessions**. Two running sessions
therefore share the theme keys, and per-session dynamic tinting is impossible.

## Mosaic standalone refresh verification

The local isolated lifecycle check ran on Herdr 0.8.2 on 2026-09-08.
`scripts/check-standalone.py` creates its own HOME, registry, config, state,
and socket. It starts no external title publisher or scheduler.

- `tab.list` without a workspace filter returns the session's tab labels.
- `plugin.list` with `plugin_id` reports `enabled` and `plugin_root`, allowing a
  detached worker to stop when its registration is disabled, removed, or moved.
- Native `tab.renamed` and `pane.agent_status_changed` hooks publish titles and
  observed-completion clocks. Model-tier metadata from another source survives.
- `[[startup]]` reconciliation launches a new per-socket-generation worker after
  server restart. Repeated reconciliation does not create a second publisher.
- Disabled workers exit. Elapsed tokens expire; durable title tokens remain.
- Explicit uninstall clears title/elapsed sources, preserves themed metadata,
  stops refresh, and restores config byte-for-byte.

Herdr's documented startup hooks are one-shot and do not supervise daemons.
Mosaic therefore starts a detached stdlib Python worker from setup/startup and
checks singleton ownership on relevant events. No manifest timer is assumed.
The existing 30-second cadence and 45-second TTL are retained. In the final
one-agent fixture, a normal round took 5.7 ms; the clock advanced from `1m` to
`2m` on the worker's next round without a new agent event.

CI pins Herdr 0.9.0 on Linux and runs the same isolated check. Local success does
not substitute for a successful CI run on the release candidate's exact SHA.

## Version notes

`min_herdr_version = "0.8.0"` is claimed because 0.8.0 is what was actually
verified. Some of these calls may exist earlier; that was not tested, and
guessing a lower bound would be a false claim.
