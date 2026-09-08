# Replace Chromatic Spaces and Pane Layouts

This checklist is for the older Chromatic and Pane Layouts plugins. For `iurysza.window-manager`, use [Move to Mosaic](./compatibility-migration.md) instead.

Mosaic takes over space colours, sidebar templates, title and elapsed publication, agent grouping, and pane layout actions. Optional model-tier metadata remains agent-provided.

## Before changing the live installation

Back up Herdr's config, plugin registry, Chromatic state and settings, label rules, and the elapsed refresh service. Keep those copies for rollback.

Rehearse the change with a separate HOME, config, plugin registry, state directory, and socket. A different Herdr session name is not enough because named sessions share config. If you cannot guarantee isolation, do not run a live rehearsal.

If chezmoi or another tool generates your sidebar and theme settings, update its source so it does not overwrite Mosaic's changes on the next apply. Do not apply a whole generated Herdr config without reviewing the diff.

## Cut over

1. Link Mosaic with hooks disabled:

   ```sh
   herdr plugin link /path/to/herdr-mosaic --disabled
   ```

2. Preview and import from the checkout:

   ```sh
   /usr/bin/python3 /path/to/herdr-mosaic/src/main.py migrate --dry-run
   /usr/bin/python3 /path/to/herdr-mosaic/src/main.py migrate
   ```

   This copies compatible identities and settings, ignores stale Chromatic backups, and records the current sidebar rows as Mosaic's restore point.
3. Disable or unlink Chromatic and unlink Pane Layouts before enabling Mosaic. Stop the external title/elapsed service as part of this approved live cutover, keeping its files for rollback. Do not invoke Chromatic's install or uninstall actions. Its old restore records can delete the elapsed/title row.
4. Update your user-managed bindings from `layouts.*` and `jackfrancisdalton.chromatic-spaces.*` to the matching `iurysza.mosaic.*` actions. Keep occupied keys such as Command Palette's binding.
5. Enable Mosaic and run setup:

   ```sh
   herdr plugin enable iurysza.mosaic
   herdr plugin action invoke iurysza.mosaic.install
   herdr plugin action invoke iurysza.mosaic.doctor
   ```

6. Check the space markers, agent titles, elapsed refresh, optional model-tier labels, and layout actions. Enable tint separately if you want it. Mosaic starts its own refresh worker during setup.

## Roll back

Disable Mosaic before restoring the cutover copies of Herdr's config and plugin data. Relink the unchanged Chromatic and Pane Layouts checkouts only after Mosaic stops writing.

Use your cutover config snapshot, not Chromatic's uninstall action. Restart the saved external refresh service only after Mosaic has stopped publishing.

Mosaic's data can remain while it is unlinked.
