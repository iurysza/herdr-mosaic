"""Import Window Manager data or older Chromatic and Pane Layouts state.

Window Manager has the same state format, including exact restore information.
Chromatic backups are incompatible and must never become Mosaic's restore point.
All imports run under ctx.Lock through main.cmd_migrate.
"""

import json
import os
import shutil

import config_patch as cp
import ctx
import identity as ident
import state as state_mod


LEGACY_WINDOW_MANAGER_ID = "iurysza.window-manager"
LEGACY_CHROMATIC_ID = "jackfrancisdalton.chromatic-spaces"
LEGACY_LAYOUTS_ID = "layouts"


class MigrationError(Exception):
    pass


def _env_path(name, default):
    v = os.environ.get(name)
    return v if v else default


def window_manager_state_dir():
    return _env_path(
        "HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR",
        os.path.join(os.path.dirname(ctx.state_dir()), LEGACY_WINDOW_MANAGER_ID),
    )


def window_manager_config_dir():
    return _env_path(
        "HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR",
        os.path.join(os.path.dirname(ctx.config_dir()), LEGACY_WINDOW_MANAGER_ID),
    )


def window_manager_pending():
    return (os.path.isfile(os.path.join(window_manager_state_dir(), "state.json"))
            and not os.path.exists(os.path.join(ctx.state_dir(), "state.json")))


def import_window_manager(dry_run=False):
    """Copy data once, preserving restore records and leaving the source intact.

    Preflight every destination before copying. Equal files allow a retry after
    a partial copy; different files are a conflict even with --force. Commit the
    state file last so startup cannot treat an incomplete import as complete.
    Caller holds Mosaic's lock; also wait for any in-flight legacy hook.
    """
    old_dir = window_manager_state_dir()
    old_path = os.path.join(old_dir, "state.json")
    target = os.path.join(ctx.state_dir(), "state.json")
    if os.path.exists(target):
        return {"notes": ["kept existing Mosaic state; Window Manager not imported"],
                "dry_run": bool(dry_run)}
    with ctx.Lock(os.path.join(old_dir, "plugin.lock")):
        old = _read_json(old_path)
        if old is None or old.get("version", 1) != state_mod.SCHEMA_VERSION:
            raise MigrationError("unsupported Window Manager state at %s" % old_path)
        copies = []
        old_config = window_manager_config_dir()
        for name in ("settings.json", "identities.json", "legacy-layouts-settings.json"):
            source = os.path.join(old_config, name)
            if os.path.exists(source):
                _read_json(source)
                copies.append((source, os.path.join(ctx.config_dir(), name)))
        for name in sorted(os.listdir(old_dir)):
            if name.startswith("config.backup.") and name.endswith(".toml"):
                copies.append((os.path.join(old_dir, name),
                               os.path.join(ctx.state_dir(), name)))
        pending = []
        for source, dest in copies:
            with open(source, "r", encoding="utf-8", newline="") as fh:
                content = fh.read()
            if os.path.exists(dest):
                with open(dest, "r", encoding="utf-8", newline="") as fh:
                    if fh.read() != content:
                        raise MigrationError("Window Manager import conflicts with %s; "
                                             "existing Mosaic files are never overwritten" % dest)
            else:
                pending.append((dest, content))
        with open(old_path, "r", encoding="utf-8", newline="") as fh:
            original_state = fh.read()
        if not dry_run:
            for dest, content in pending:
                ctx.atomic_write(dest, content)
            ctx.atomic_write(os.path.join(ctx.state_dir(), "window-manager-import.json"),
                             json.dumps({"source": old_path}) + "\n")
            ctx.atomic_write(target, original_state)
        return {
            "window_manager_state_dir": old_dir,
            "window_manager_config_dir": old_config,
            "files_copied": [dest for dest, _ in pending] + [target],
            "dry_run": bool(dry_run),
            "notes": ["preserved Window Manager state, including restore backups",
                      "left original files in place; Chromatic state not imported"],
        }


def chromatic_state_dir():
    return _env_path(
        "HERDR_LEGACY_CHROMATIC_STATE_DIR",
        os.path.join(ctx.HOME, ".local", "state", "herdr", "plugins", LEGACY_CHROMATIC_ID),
    )


def chromatic_config_dir():
    return _env_path(
        "HERDR_LEGACY_CHROMATIC_CONFIG_DIR",
        os.path.join(ctx.HOME, ".config", "herdr", "plugins", "config", LEGACY_CHROMATIC_ID),
    )


def layouts_state_dir():
    return _env_path(
        "HERDR_LEGACY_LAYOUTS_STATE_DIR",
        os.path.join(ctx.HOME, ".local", "state", "herdr", "plugins", LEGACY_LAYOUTS_ID),
    )


def layouts_config_dir():
    return _env_path(
        "HERDR_LEGACY_LAYOUTS_CONFIG_DIR",
        os.path.join(ctx.HOME, ".config", "herdr", "plugins", "config", LEGACY_LAYOUTS_ID),
    )


def _read_json(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (ValueError, OSError) as exc:
        raise MigrationError("unreadable %s: %s" % (path, exc))
    if data is not None and not isinstance(data, dict):
        raise MigrationError("%s is not a JSON object" % path)
    return data


def _copy_file(src, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(src, dest)


def _normalise_identities(raw):
    out = {}
    for wid, info in (raw or {}).items():
        if not isinstance(wid, str) or not wid or not isinstance(info, dict):
            continue
        colour = ident.resolve_colour(info.get("colour") or "")
        if not colour:
            continue
        origin = info.get("origin") or "auto"
        if origin not in ("auto", "manual", "label"):
            origin = "auto"
        out[wid] = {"colour": colour, "origin": origin}
    return out


def _identity_conflicts(current, incoming):
    conflicts = []
    for wid, info in sorted(incoming.items()):
        have = current.get(wid)
        if have and have.get("colour") != info.get("colour"):
            conflicts.append((wid, have.get("colour"), info.get("colour")))
    return conflicts


def snapshot_ownership_baseline(st, doc=None):
    """Record live config values as this plugin's restore point.

    Never copies Chromatic backups. Captures spaces/agents rows as they are now.
    """
    doc = doc if doc is not None else cp.load_doc()
    keys = ["ui.sidebar.spaces.rows", "ui.sidebar.agents.rows"]
    captured = cp.capture_backup(doc, keys)
    if st.get("ownership_baseline") is None:
        st["ownership_baseline"] = captured
    if st.get("sidebar_backup") is None:
        # Live rows, not a leftover baseline from a previous ownership cycle.
        st["sidebar_backup"] = captured
    return st["ownership_baseline"]


def import_legacy(st, force=False, dry_run=False):
    """Import Chromatic identities/settings and layouts settings.

    Returns a report dict. Raises MigrationError on identity conflicts unless
    force=True. Never applies sidebar_backup, theme_backup, or last_written from
    the old plugin.
    """
    report = {
        "chromatic_state_dir": chromatic_state_dir(),
        "chromatic_config_dir": chromatic_config_dir(),
        "layouts_state_dir": layouts_state_dir(),
        "identities_imported": [],
        "settings_copied": False,
        "layouts_settings_copied": False,
        "label_rules_copied": False,
        "ignored_stale_backups": [],
        "notes": [],
        "dry_run": bool(dry_run),
    }

    old_path = os.path.join(chromatic_state_dir(), "state.json")
    old = _read_json(old_path)
    if old is None:
        report["notes"].append("no Chromatic state.json at %s" % old_path)
    else:
        if old.get("sidebar_backup"):
            report["ignored_stale_backups"].append("sidebar_backup")
        if old.get("theme_backup"):
            report["ignored_stale_backups"].append("theme_backup")
        if old.get("last_written"):
            report["ignored_stale_backups"].append("last_written")
        report["notes"].append(
            "retained Chromatic state at %s for rollback; not applied as config backup"
            % old_path
        )

        incoming = _normalise_identities(old.get("identities"))
        current = dict(st.get("identities") or {})
        conflicts = _identity_conflicts(current, incoming)
        if conflicts and not force:
            detail = "; ".join(
                "%s: have %s, chromatic %s" % (wid, have, want)
                for wid, have, want in conflicts
            )
            raise MigrationError(
                "identity conflicts with Chromatic state (pass --force to overlay): %s"
                % detail
            )
        for wid, info in incoming.items():
            if dry_run:
                report["identities_imported"].append(wid)
                continue
            st.setdefault("identities", {})[wid] = info
            report["identities_imported"].append(wid)
        if old.get("alloc_cursor") is not None and (force or st.get("alloc_cursor") in (0, None)):
            if not dry_run:
                st["alloc_cursor"] = int(old.get("alloc_cursor") or 0)
        if old.get("view_mode") in ("all", "current") and not st.get("view_installed"):
            if not dry_run:
                st["view_mode"] = old["view_mode"]
        if old.get("tint_enabled") and not st.get("tint_enabled"):
            report["notes"].append(
                "Chromatic tint was enabled; not auto-enabling. Run tint-enable after cutover."
            )

    old_settings = os.path.join(chromatic_config_dir(), "settings.json")
    new_settings = ctx.settings_path()
    if os.path.exists(old_settings) and not os.path.exists(new_settings):
        report["settings_copied"] = True
        if not dry_run:
            _copy_file(old_settings, new_settings)
            report["notes"].append("copied Chromatic settings.json (new file only)")
    elif os.path.exists(old_settings) and os.path.exists(new_settings):
        report["notes"].append("kept existing plugin settings.json; Chromatic settings left in place")

    layouts_settings = os.path.join(layouts_config_dir(), "settings.json")
    dest_layouts = os.path.join(ctx.config_dir(), "legacy-layouts-settings.json")
    if os.path.exists(layouts_settings):
        report["layouts_settings_copied"] = True
        if not dry_run and not os.path.exists(dest_layouts):
            _copy_file(layouts_settings, dest_layouts)
            report["notes"].append("copied layouts settings to legacy-layouts-settings.json")

    import labels
    src_rules = labels.rules_path()
    dest_rules = os.path.join(ctx.config_dir(), "identities.json")
    if os.path.exists(src_rules) and os.path.abspath(src_rules) != os.path.abspath(dest_rules):
        if not os.path.exists(dest_rules):
            report["label_rules_copied"] = True
            if not dry_run:
                _copy_file(src_rules, dest_rules)
                report["notes"].append("copied label identities from %s" % src_rules)
        else:
            report["notes"].append("kept existing identities.json; source rules left in place")

    if not dry_run:
        snapshot_ownership_baseline(st)
        report["notes"].append("snapshotted current config as ownership baseline")

    return report


def run(argv):
    force = "--force" in argv
    dry_run = "--dry-run" in argv
    imported = os.path.exists(os.path.join(ctx.state_dir(), "window-manager-import.json"))
    if imported and os.path.exists(os.path.join(ctx.state_dir(), "state.json")):
        report = {"notes": ["kept existing Mosaic state; Window Manager was already imported"],
                  "dry_run": bool(dry_run)}
    elif os.path.isfile(os.path.join(window_manager_state_dir(), "state.json")):
        report = import_window_manager(dry_run=dry_run)
    else:
        st = state_mod.load()
        report = import_legacy(st, force=force, dry_run=dry_run)
        if not dry_run:
            state_mod.save(st)
    print(json.dumps(report, indent=2, sort_keys=True))
    if report.get("ignored_stale_backups"):
        print(
            "ignored stale Chromatic backups: %s"
            % ", ".join(report["ignored_stale_backups"])
        )
    return 0
