# Provenance

This plugin bundles two existing implementations. It does not rewrite them in
typed Python or uv.

## Chromatic Spaces

- Upstream: `jackfrancisdalton/herdr-chromatic-spaces`
- Imported commit: `910c3daf04124c91afe4c0f01a09c0442658ead5`
- Licence: MIT, Copyright (c) 2026 Jack Dalton — see [LICENSE](../LICENSE)
- What was kept: identity/palette, picker, tint, grouped `agent.view`, surgical
  `config.toml` edits, conflict detection, byte-exact restore, startup reconcile
- What changed: plugin id `iurysza.window-manager`; agents sidebar no longer
  receives `$sd_*` dots; agents row is the live elapsed/title/tier template

## Pane Layouts

- Upstream: `iurysza/herdr-pane-layouts`
- Imported commit: `0ef0a8d5d463757f06037551fc1f5ef6dfde478d` (v0.1.1)
- Licence: no separate LICENSE file in that repo; code is adapted here with
  attribution in `src/layouts.py` and `src/layout_actions.py`
- What was kept: presets, insertion plan, staging-tab reshape, 2% resize,
  zoomed-tab refusal, recovery on failure
- What changed: Python 3.6 syntax; Herdr calls go through `rpc.py`; mutations
  run under `ctx.Lock`; actions are `iurysza.window-manager.{equalize,cycle,resize-*}`

## Not imported

- `herdr-agent-elapsed` publisher / LaunchAgent
- Themed-agent routing (AltPi / agents repo)
- Last-focus / Ctrl+Tab
- Chezmoi Herdr templates and the agents installer
