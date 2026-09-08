# Contributing to Mosaic

The README explains the plugin to a user; this explains it to whoever is changing
it. Read `docs/herdr-api-findings.md` before touching anything that talks to Herdr
— it records what was verified against the binary, and several findings cost real
effort to discover.

## What it is

Personal Herdr window manager: Chromatic space colour identity, current spaces and
agents sidebar templates, grouped agent view, optional chrome tint, and existing
Pane Layouts actions. Plugin id `iurysza.mosaic`, version 0.1.0.

Last-focus is deferred. Mosaic publishes titles and elapsed tokens itself using
`sidebar.py` and a detached `refresh.py` worker. `$themed_model_tier` remains
optional agent-provided metadata; Mosaic must never write or clear it.

The worker uses the existing `agent-sidebar-title` and `agent-elapsed` sources.
Titles have no TTL. Elapsed uses the measured 30-second refresh / 45-second TTL
contract. Do not run an external publisher at the same time after cutover.

## Non-negotiables

- **Python standard library only, 3.6+.** Every command uses `/usr/bin/python3`
  directly — no launcher, no packages, no `[[build]]` section.
- **Every mutation runs under `ctx.Lock`.** Multiple hooks can fire concurrently;
  the file lock serialises all state and config writes. Never bypass it. Layout
  reshape/resize use the same lock.
- **Config edits go through `config_patch.py`.** It validates via `herdr config check`
  before writing, takes a backup, and detects external modifications. Never write
  `config.toml` directly.
- **`uninstall` must be reversible.** The plugin records the exact pre-plugin value
  of every key it touches (including "was absent"). Restoration must be byte-exact.
- **Never apply Chromatic `sidebar_backup` / `theme_backup` / `last_written`.** Those
  backups pre-date the elapsed/title agent row and would destroy it.
- **Window Manager is different from Chromatic.** Its `iurysza.window-manager`
  state uses the same schema as Mosaic. Import its complete state and restore
  records without rewriting them, then skip older Chromatic imports. Keep source
  files for rollback and never overwrite existing Mosaic data.
- **Do not edit a live-linked checkout during a rename.** Use a separate worktree.
  Follow `docs/migration.md` before changing the live registration.

## Things that will bite you

Each of these was a real bug, not a hypothetical:

- **`workspace.focused` fires on every focus change, including repeat focuses.**
  The hook compares resulting theme values against what is already active and exits
  silently if nothing changed — no write, no reload. Remove that guard and the
  config reloads on every tab click.
- **Herdr metadata is runtime-only.** `session.snapshot` workspace/pane metadata
  does not survive a server restart. `state.json` is the database of record; the
  `[[startup]]` `reconcile` hook re-publishes everything from it after restore.
- **The sidebar `rows` array is static config.** One array serves every Space, so
  per-Space foreground colours are impossible. Spaces use pre-styled `$sd_*`
  tokens. Agents use `$elapsed` + 12 `$title_*` + `$themed_model_tier` (15 tokens).
  Do not add `$sd_*` to the agent row — Herdr's cap is 16.
- **`rows_by_agent` fully replaces `rows` for matching agents.** This plugin never
  creates those entries and never rewrites ones that already exist.
- **Two sessions fight over `config.toml`.** Named sessions share one config file;
  concurrent `workspace.focused` hooks from two sessions will overwrite each other.
  `doctor` warns when more than one session is detected.
- **Luminance ceilings are solved exactly, not clamped.** At `bold` intensity every
  palette colour hits its ceiling — they differ only in hue, not depth. Change the
  blend fractions and re-derive the ceiling if you change the palette.
- **Vanilla Chromatic `install`/`uninstall` is unsafe on a machine that already
  has the elapsed/title agent row.** Do not run them against live config.

## Testing

```sh
python3 -m unittest discover -s tests -t tests     # stdlib only
python3 scripts/check-standalone.py                # isolated real Herdr lifecycle
```

Config fixtures are validated by the real `herdr config check` binary. The suite
covers state serialisation, identity stability across rename, default allocation,
colour blending, config patching against real-world config fixtures,
byte-exact restoration, idempotent reconciliation, unified sidebar token limits,
`rows_by_agent` preservation, stale Chromatic backup refusal, label rules, and
layout dispatch under the plugin lock.

## Verifying live

Do not point doctor or install at the default session until cutover is approved.
Use a fully isolated disposable Herdr HOME/config/socket/registry, or skip.

```sh
python3 src/main.py doctor
herdr plugin action invoke iurysza.mosaic.doctor
```

## Working in a live session

- **`~/.config/herdr/plugins/config/iurysza.mosaic/settings.json`
  is the user's config.** Read it before assuming anything about state; do not
  delete it without asking.
- State lives at `~/.local/state/herdr/plugins/iurysza.mosaic/`.
  Chromatic state at `jackfrancisdalton.chromatic-spaces` is retained for rollback.
- Run `uninstall` before unlinking when testing the full lifecycle — unlinking
  without it leaves sidebar tokens and theme overrides in `config.toml`.

## Layout

`src/` is small modules with one job each: `main.py` dispatches, `ctx.py` holds
env/paths/settings/locking, `rpc.py` talks to the Herdr socket, `state.py` owns
the durable identity map, `identity.py` owns the palette and allocation,
`labels.py` applies portable label→colour rules, `theme.py` handles colour blending,
`config_patch.py` edits `config.toml`, `toml_edit.py` is the surgical TOML writer,
`metadata.py` publishes workspace/pane metadata, `agent_view.py` manages the native
agent projection, `picker.py` and `board.py` are the two popup panes,
`layouts.py` is the pure layout core, `layout_actions.py` reshapes/resizes under
the plugin lock, `migrate.py` imports Window Manager data intact, or Chromatic/layouts state
without applying stale Chromatic config backups. `sidebar.py` renders title/clock
metadata and `refresh.py` owns per-socket scheduling. `scripts/check-standalone.py`
proves install, timer refresh, restart, and cleanup without live setup.
