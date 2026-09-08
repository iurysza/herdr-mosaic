# Cutover and rollback

This plugin is implemented in the `herdr-window-manager` worktree. It is **not**
linked, and this document does not apply live config. Agents-repo and chezmoi
integration are prerequisites for a later parent-authorized cutover — they are
not implemented here.

## Ownership after cutover

`iurysza.window-manager` owns:

- Space identity, picker, optional tint, grouped agent view
- `ui.sidebar.spaces.rows` (state icon + `$sd_*` + workspace / branch / git_status)
- `ui.sidebar.agents.rows` (`state_icon` + `$elapsed` + 12 `$title_*` + `$themed_model_tier`)
- Pane layout actions

It consumes, and does not replace:

- `$elapsed` and `$title_*` from LaunchAgent `com.iurysouza.herdr-agent-elapsed`
- `$themed_model_tier` from themed Pi

Chezmoi currently regenerates sidebar rows from
`.chezmoitemplates/herdr-config-base.toml`. A later cutover must stop that, or
the next `chezmoi apply` will drop `$themed_model_tier`. Do not run
`./install.sh --apply` against `~/.config/herdr/config.toml` wholesale.

## Do not do this

- Do **not** run Chromatic `install` or `uninstall` against the live config.
  Live `state.json` still thinks it owns the old `$sd_*` agent row, and
  `sidebar_backup` records `ui.sidebar.agents.rows` as originally absent.
  Uninstall would delete the elapsed/title row.
- Do **not** trust Chromatic `theme_backup` / `sidebar_backup` / `last_written`
  as the restore point for this plugin. `migrate` copies identities only and
  snapshots the **current** config as the new baseline.

## Suggested cutover (later, after approval)

1. Snapshot live `config.toml`, Chromatic state/settings, identities JSON, and
   the elapsed unit. Keep Chromatic's state directory in place.
2. Isolate a disposable Herdr session (separate HOME, config, socket, plugin
   registry). Rehearse `migrate` then `install` there first.
3. Link this plugin. Run `migrate` then `install`. Confirm doctor, spaces dots,
   blank-ok coloured titles, optional tint, and layout actions.
4. Disable/unlink GitHub Chromatic `jackfrancisdalton.chromatic-spaces` **and**
   unlink the `layouts` plugin. If both this plugin and `layouts` stay linked,
   two reshapers can run with different locks. Leave `herdr-agent-elapsed`
   running. Leave the old Chromatic state dir for rollback.
5. Update keybindings from `layouts.*` and `jackfrancisdalton.chromatic-spaces.*`
   to `iurysza.window-manager.*`. Live `prefix+i` is Command Palette; picker
   default remains `prefix+i` only if that key is free.
6. Stop chezmoi from writing plugin-owned sidebar/theme keys.

## Rollback

1. Relink Chromatic at `910c3daf`.
2. Restore the **cutover snapshot** of `config.toml`, not Chromatic uninstall
   against a file this plugin already owns.
3. Keep the elapsed unit. Do not restore an older tracked
   `herdr-agent-elapsed` over the live binary.
4. This plugin's state dir can remain; it is unused once unlinked.

## Isolation rule for rehearsal

A different `--session` name is not enough. Named sessions share `config.toml`.
Rehearsal needs isolated config, plugin registry, state, and socket, with no
fallback to live defaults. If that cannot be guaranteed, do not mutate live
Herdr.
