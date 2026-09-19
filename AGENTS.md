# Contributing to Mosaic

The README explains the plugin to a user; this explains it to whoever is changing
it. Read `docs/herdr-api-findings.md` before touching anything that talks to Herdr
— it records what was verified against the binary, and several findings cost real
effort to discover.

## What it is

Mosaic is an experimental Herdr plugin for space colours, agent grouping,
sidebar titles and elapsed labels, optional chrome tint, and pane layouts.
Plugin id `iurysza.mosaic`, version 0.5.0.

Public docs present the product, not its migration or personal rollout history.
Keep runtime compatibility, regression tests, and licence notices intact.

Last-focus is deferred. Mosaic publishes titles and elapsed tokens itself using
`src/agents/sidebar-publish.ts` and a detached refresh worker. `$themed_model_tier`
remains optional agent-provided metadata; Mosaic must never write or clear it.

The worker uses the existing `agent-sidebar-title` and `agent-elapsed` sources.
Titles have no TTL. Elapsed uses the measured 30-second refresh / 45-second TTL
contract. Do not run another publisher for those tokens at the same time.

## Non-negotiables

- **TypeScript, Bun, and Effect.** Production commands use the compiled Mosaic
  binary. Pin Bun, Effect, Oxlint, and vendored anti-slop rules. Tests replace
  external capabilities; do not mock application modules, including via
  `bun:test` `mock.module`.
- **Every mutation runs under `ctx.Lock`.** Multiple hooks can fire concurrently;
  the file lock serialises all state and config writes. Never bypass it. Layout
  reshape/resize use the same lock.
- **Config edits go through `src/config/patch.ts`.** It validates via `herdr config check`
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
  Preserve original config and state before changing a live registration.
  Restore its ownership before importing post-restore data into Mosaic.

## Git commits

Never include Cursor (or any Cursor agent/bot) as git author, committer, or in a Co-authored-by / similar trailer.

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
bun run typecheck && bun run lint && bun run test
bun run test:runtime && bun run build && bun run test:artifact
bun run test:herdr
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
./dist/mosaic doctor
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

Production code lives under `src/` as TypeScript modules: `cli.ts` dispatches,
`runtime/` holds env/paths/locking/RPC/the worker, `config/` edits `config.toml`,
`state/` owns the durable identity map, `spaces/` owns palette, labels, and theme,
`agents/` manages views, triage, titles, and clocks, `panes/` owns layouts and
pane moves, `terminal/` owns raw TTY sessions, and `lifecycle/` owns
install/doctor/uninstall. `tests/herdr/lifecycle.test.ts` proves installation
and byte-exact cleanup in an isolated Herdr environment.
