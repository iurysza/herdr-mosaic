# Move to Mosaic

Mosaic replaces Window Manager. The repo is `iurysza/herdr-mosaic`, and the plugin ID is `iurysza.mosaic`. Action suffixes such as `equalize` and `set-identity` are unchanged.

Do not enable both plugins. They would publish the same sidebar tokens and edit the same Herdr config under separate locks.

## From Window Manager

Keep the old checkout unchanged until you finish the restore step. Updating a checkout that Herdr already runs changes the code used by its hooks immediately.

1. Back up Herdr's `config.toml` and Window Manager's state and config directories. Record any custom picker binding and whether tint is enabled. Keep these backups outside the plugin directories.
2. While the old plugin is still linked, restore its config:

   ```sh
   herdr plugin action invoke iurysza.window-manager.uninstall
   ```

   Check the output for skipped user-modified keys. Resolve those before continuing. Do not use `--force` without reviewing what it would overwrite. Save another copy of the state and settings after this restore step; use that copy for import if plugin removal deletes the directories.
3. Remove the old registration. For a linked checkout:

   ```sh
   herdr plugin unlink iurysza.window-manager
   ```

   For a GitHub install, use `herdr plugin uninstall iurysza.window-manager`. Keep the old state and settings available for the import. If removal deleted them, restore the post-restore copies from step 2 before migrating.
4. Link the Mosaic checkout with hooks disabled:

   ```sh
   herdr plugin link /path/to/herdr-mosaic --disabled
   ```

5. Import from that checkout before enabling it:

   ```sh
   /usr/bin/python3 /path/to/herdr-mosaic/src/main.py migrate --dry-run
   /usr/bin/python3 /path/to/herdr-mosaic/src/main.py migrate
   ```

   Run these in a normal Herdr terminal, without `HERDR_PLUGIN_STATE_DIR` or `HERDR_PLUGIN_CONFIG_DIR` overrides from another plugin. For custom directories, pass Mosaic's destination paths and the source overrides listed below.
6. During the approved live cutover, stop the old `herdr-agent-elapsed` refresh service before enabling Mosaic. Keep its files for rollback. Mosaic supplies both title publication and elapsed scheduling; the old service must not keep publishing those same tokens.
7. Enable Mosaic and apply its setup:

   ```sh
   herdr plugin enable iurysza.mosaic
   herdr plugin action invoke iurysza.mosaic.install
   herdr plugin action invoke iurysza.mosaic.doctor
   ```

8. Setup retargets remaining `plugin_action` bindings from `iurysza.window-manager.*` to `iurysza.mosaic.*`, keeping keys, descriptions, and action suffixes. It saves exact restore records before writing config. If a dotfiles tool owns those bindings, update its source separately. Restore your custom picker binding if the old uninstall removed it, and enable tint again if you used it.

### What the import preserves

Mosaic copies Window Manager's `state.json` without rewriting it. This preserves space identities, view preferences, last-settled timestamps, and any remaining restore records. It also copies:

- `settings.json`, `identities.json`, and `legacy-layouts-settings.json`, when present.
- `config.backup.*.toml` snapshots.

The `migrate` command leaves source files in place. It does not edit Herdr's config, keybindings, or runtime metadata. The restore step above clears Window Manager's runtime ownership before Mosaic takes over. The later `install` action retargets old action bindings through the validated config writer. Uninstall restores their original text unless the user has since changed the binding.

Window Manager data takes precedence over older Chromatic data. Once Mosaic has a state file, another import keeps it. A different file at a destination blocks the initial import, including with `--force`. Identical files allow a retry after an interrupted copy.

The default source directories are siblings of Mosaic's directories, named `iurysza.window-manager`. For a custom layout, set `HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR` and `HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR`.

Startup and event commands refuse to create new Mosaic state while Window Manager data awaits import. Run `migrate` explicitly to continue.

## From Chromatic Spaces or Pane Layouts

Use the [cutover checklist](./chromatic-cutover.md). Mosaic imports Chromatic identities and settings but ignores its old `sidebar_backup`, `theme_backup`, and `last_written` records. It records the current Herdr config as the new restore point.

Do not run Chromatic's install or uninstall actions against a config with the elapsed/title agents row. Its old backups can remove that row.

## Roll back

Run Mosaic's `uninstall` action, then remove its registration. Restore the config and Window Manager data saved in step 1 before relinking the unchanged old checkout. Restart the old refresh service only after Mosaic has stopped publishing. Do not run both plugins during rollback.

Mosaic's data can remain in its directories while it is unlinked. Moving back to Mosaic later will keep that data rather than import Window Manager again.
