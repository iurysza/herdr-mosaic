#!/usr/bin/env python3
"""iurysza.mosaic -- entry point for every manifest command.

Subcommands map 1:1 onto manifest startup hooks, event hooks, actions and pane
entrypoints. Every mutating path runs under one exclusive lock (ctx.Lock) and
commits config through config_patch.commit(), which validates with
`herdr config check` before an atomic rename.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import agent_view
import config_patch as cp
import ctx
import identity as ident
import metadata
import rpc
import state as state_mod
import theme as theme_mod
from toml_edit import MISSING


# --------------------------------------------------------------------------
# shared helpers
# --------------------------------------------------------------------------

def _theme_name(doc):
    val = doc.get(("theme", "name"))
    return None if val is MISSING else val


def _ensure_identity(st, workspace_id, workspaces=None):
    workspaces = rpc.workspaces() if workspaces is None else workspaces
    import labels
    labelled = set(labels.apply(st, workspaces))
    for wid in labelled:
        labelled_info = state_mod.identity_of(st, wid)
        if labelled_info and labelled_info.get("colour"):
            metadata.publish_workspace(wid, labelled_info["colour"])
    info = state_mod.identity_of(st, workspace_id)
    if info:
        return info, workspace_id in labelled
    info = ident.allocate(st, workspace_id, workspaces)
    st.setdefault("identities", {})[workspace_id] = info
    ctx.log("assigned identity %s %s to %s"
            % (metadata.marker(), ident.colour_name(info["colour"]),
               workspace_id))
    return info, True


def _label_for(workspace_id, workspaces=None):
    workspaces = rpc.workspaces() if workspaces is None else workspaces
    for w in workspaces:
        if w.get("workspace_id") == workspace_id:
            return w.get("label") or workspace_id
    return workspace_id


def _set_window_title(st, label, settings):
    if not settings.get("window_title"):
        return
    title = "%s %s%s" % (metadata.marker(), label,
                         settings.get("window_title_suffix") or "")
    _, err = rpc.try_call("client.window_title.set", {"title": title})
    if err:
        ctx.warn("window title failed: %s" % err)
    else:
        st["window_title_set"] = True


def _clear_window_title(st):
    if not st.get("window_title_set"):
        return
    _, err = rpc.try_call("client.window_title.clear", {})
    if err:
        ctx.warn("window title clear failed: %s" % err)
    st["window_title_set"] = False


def _reload_config():
    res, err = rpc.try_call("server.reload_config", {})
    if err:
        ctx.warn("config reload failed: %s" % err)
        return None
    diags = (res or {}).get("diagnostics") or []
    for d in diags:
        ctx.warn("reload diagnostic: %s" % d)
    return res


# --------------------------------------------------------------------------
# tint
# --------------------------------------------------------------------------

def _apply_tint(st, workspace_id, force=False, workspaces=None):
    """Write one space's theme values. Returns 'applied'|'noop'|'conflict'|'skip'."""
    settings = ctx.settings()
    info, _ = _ensure_identity(st, workspace_id, workspaces)
    doc = cp.load_doc()
    theme_name = _theme_name(doc)

    if theme_mod.is_light_theme(theme_name):
        ctx.warn("theme %r looks light; the derived surfaces assume a dark base "
                 "(set settings.theme_base to override)" % theme_name)

    values = theme_mod.generate(info["colour"], theme_name, settings)
    managed = set(theme_mod.managed_keys(settings))

    last = st.get("last_tint") or {}
    if (last.get("workspace_id") == workspace_id and last.get("values") == values
            and all(doc.get(cp.dotted(k)) == v for k, v in values.items())):
        return "noop", values

    conflicts = cp.detect_conflicts(doc, st.get("last_written"), only_keys=managed)
    if conflicts and not force:
        ctx.warn("theme keys were modified outside the plugin; not overwriting. "
                 "%s. Re-run with --force to take them over."
                 % "; ".join("%s (expected %r, found %r)" % c for c in conflicts))
        return "conflict", values

    if st.get("theme_backup") is None:
        cp.snapshot()
        st["theme_backup"] = cp.capture_backup(
            doc, sorted(set(theme_mod.TINT_KEYS) | set(theme_mod.OVERLAY_KEYS)))
        ctx.log("captured theme backup for %d keys"
                % len(st["theme_backup"]["keys"]))

    cp.apply_values(doc, values)
    try:
        cp.commit(doc)
    except cp.ConfigError as exc:
        ctx.warn(str(exc))
        return "skip", values

    st.setdefault("last_written", {}).update(values)
    st["last_tint"] = {"workspace_id": workspace_id, "values": values}
    _reload_config()
    ctx.log("theme applied for %s (%s %s -> accent %s)"
            % (workspace_id, metadata.marker(),
               ident.colour_name(info["colour"]), values["ui.accent"]))
    return "applied", values


def _restore_theme(st, doc, force=False):
    """Restore theme keys to their pre-plugin state. Returns (restored, skipped)."""
    backup = st.get("theme_backup")
    if not backup:
        return [], []
    managed = set((backup.get("keys") or {}).keys())
    conflicts = cp.detect_conflicts(doc, st.get("last_written"), only_keys=managed)
    skip = set()
    if conflicts and not force:
        for key, exp, act in conflicts:
            ctx.warn("%s changed outside the plugin (plugin wrote %r, found %r); "
                     "leaving it alone -- use --force to restore anyway"
                     % (key, exp, act))
            skip.add(key)
    restored = cp.restore_backup(
        doc, backup, tidy_tables=(("theme", "custom"),), skip=skip)
    return restored, sorted(skip)


# --------------------------------------------------------------------------
# commands: startup + events
# --------------------------------------------------------------------------

def cmd_reconcile(argv):
    """Startup reconciliation. Idempotent."""
    with ctx.Lock():
        st = state_mod.load()
        workspaces = rpc.workspaces()
        agents = rpc.agents()
        metadata.reconcile(st, workspaces, agents)

        if st.get("sidebar_installed"):
            # rows live in config.toml and persist on their own; nothing to redo.
            pass
        if st.get("view_installed"):
            _, err = agent_view.install(st.get("view_mode") or "all")
            if err:
                ctx.warn("agent view reinstall failed: %s" % err)
            else:
                ctx.log("agent view reapplied (%s)" % (st.get("view_mode") or "all"))

        if st.get("tint_enabled"):
            w = rpc.focused_workspace()
            if w:
                status, _ = _apply_tint(st, w["workspace_id"], workspaces=workspaces)
                if status == "applied":
                    info = state_mod.identity_of(st, w["workspace_id"])
                    _set_window_title(st, w.get("label") or w["workspace_id"],
                                      ctx.settings())
        state_mod.save(st)
    return 0


def cmd_event(argv):
    name = argv[0] if argv else (ctx.event_name() or "")
    payload = ctx.event_payload()
    if not isinstance(payload, dict):
        payload = {}
    data = payload.get("data") or payload
    if not isinstance(data, dict):
        data = {}

    if name == "workspace.focused":
        return _on_workspace_focused(data)
    if name in ("workspace.created", "workspace.renamed", "workspace.updated",
                "workspace.moved", "workspace.reordered"):
        return _on_workspace_changed(name, data)
    if name == "workspace.closed":
        return _on_workspace_closed(data)
    if name in ("pane.created", "pane.moved", "pane.agent_detected"):
        return _on_pane_changed(name, data)
    if name == "tab.renamed":
        return 0  # Publication after dispatch reads the current tab label.
    if name == "pane.agent_status_changed":
        return _on_agent_status_changed(data)
    if name in ("pane.closed", "pane.exited"):
        return _on_pane_gone(data)
    ctx.warn("unhandled event %r" % name)
    return 0


def _event_workspace_id(data):
    ws = data.get("workspace") or {}
    return ws.get("workspace_id") or data.get("workspace_id")


def _on_workspace_focused(data):
    with ctx.Lock():
        st = state_mod.load()
        settings = ctx.settings()
        # Read the authoritative focused workspace rather than trusting the
        # event payload: during rapid switching several hooks race, and using
        # live state makes them all converge on the final workspace with a
        # single config write.
        w = rpc.focused_workspace()
        if not w:
            return 0
        wid = w["workspace_id"]
        label = w.get("label") or wid
        info, created = _ensure_identity(st, wid)
        if created:
            metadata.publish_workspace(wid, info["colour"])

        changed_space = (st.get("last_tint") or {}).get("workspace_id") != wid
        if changed_space and settings.get("announce"):
            rpc.try_call("notification.show", {
                "title": "%s %s" % (metadata.marker(), label),
                "body": ident.colour_name(info["colour"]),
                "sound": "none",
            })
        if st.get("tint_enabled"):
            status, _ = _apply_tint(st, wid)
            if status == "applied":
                _set_window_title(st, label, settings)
            elif status == "noop" and changed_space:
                _set_window_title(st, label, settings)
        elif settings.get("window_title") and changed_space:
            _set_window_title(st, label, settings)
            st["last_tint"] = {"workspace_id": wid,
                               "values": (st.get("last_tint") or {}).get("values")}
        state_mod.save(st)
    return 0


def _on_workspace_changed(name, data):
    wid = _event_workspace_id(data)
    with ctx.Lock():
        st = state_mod.load()
        workspaces = rpc.workspaces()
        if wid:
            info, created = _ensure_identity(st, wid, workspaces)
            metadata.publish_workspace(wid, info["colour"])
            if name == "workspace.renamed":
                # identity is keyed on ID, so it is unchanged; agent panes just
                # need the new label re-published
                for a in rpc.agents():
                    if a.get("workspace_id") == wid:
                        metadata.republish_pane(st, a["pane_id"], workspaces)
                ctx.log("workspace %s renamed to %r; identity %s unchanged"
                        % (wid, _label_for(wid, workspaces),
                           ident.colour_name(info["colour"])))
            elif created:
                ctx.log("workspace %s created; identity %s"
                        % (wid, ident.colour_name(info["colour"])))
        else:
            metadata.reconcile(st, workspaces, quiet=True)
        state_mod.save(st)
    return 0


def _on_workspace_closed(data):
    wid = _event_workspace_id(data)
    if not wid:
        return 0
    with ctx.Lock():
        st = state_mod.load()
        # Keep the identity: a closed space may be restored, and stable identity
        # across restarts is the point. Only drop the tint bookkeeping.
        if (st.get("last_tint") or {}).get("workspace_id") == wid:
            st["last_tint"] = None
        state_mod.save(st)
        ctx.log("workspace %s closed; identity retained" % wid)
    return 0


def _on_agent_status_changed(data):
    import agent_tracker
    parsed = agent_tracker.parse_status_event(data)
    if parsed is None:
        return 0
    pane_id, status = parsed
    with ctx.Lock():
        st = state_mod.load()
        if agent_tracker.apply_to_state(st, pane_id, status, int(time.time())):
            state_mod.save(st)
    return 0


def _on_pane_gone(data):
    import agent_tracker
    pane_id = agent_tracker.parse_pane_id(data)
    if not pane_id:
        return 0
    with ctx.Lock():
        st = state_mod.load()
        if agent_tracker.forget_pane(st, pane_id):
            state_mod.save(st)
    return 0


def _on_pane_changed(name, data):
    pane = data.get("pane") or {}
    pane_id = pane.get("pane_id") or data.get("pane_id")
    if not pane_id:
        return 0
    with ctx.Lock():
        st = state_mod.load()
        agents = rpc.agents()
        is_agent = any(a.get("pane_id") == pane_id for a in agents)
        if not is_agent:
            # pane.created fires before an agent is detected; pane.agent_detected
            # will follow if one appears.
            return 0
        if metadata.republish_pane(st, pane_id):
            if name == "pane.moved":
                ctx.log("pane %s moved; identity now %s"
                        % (pane_id, ident.colour_name(
                            (state_mod.identity_of(
                                st, metadata.workspace_id_of_pane(pane_id)) or {})
                            .get("colour"))))
            elif name == "pane.agent_detected":
                ctx.log("agent detected in %s; identity published" % pane_id)
        state_mod.save(st)
    return 0


# --------------------------------------------------------------------------
# commands: actions
# --------------------------------------------------------------------------

def _context_workspace_id():
    """Workspace an action was invoked from (Herdr resolves this to the focused one)."""
    c = ctx.invocation_context()
    wid = c.get("workspace_id")
    if wid:
        return wid
    w = rpc.focused_workspace()
    return w["workspace_id"] if w else None


def cmd_auto_assign(argv):
    force = "--force" in argv
    with ctx.Lock():
        st = state_mod.load()
        workspaces = rpc.workspaces()
        if force:
            wid = _context_workspace_id()
            if wid:
                st.setdefault("identities", {}).pop(wid, None)
        added = ident.ensure_all(st, workspaces)
        metadata.reconcile(st, workspaces)
        state_mod.save(st)
        print("assigned: %s" % (", ".join(added) if added else "(all spaces already had identities)"))
    return 0


def cmd_set_identity(argv):
    """Open the identity picker for the invoking workspace."""
    wid = _context_workspace_id()
    if not wid:
        ctx.warn("could not resolve a workspace to edit")
        return 1
    res, err = rpc.try_call("plugin.pane.open", {
        "plugin_id": ctx.PLUGIN_ID,
        "entrypoint": "picker",
        "focus": True,
        "placement": "popup",
        "env": {"SPACE_IDENTITY_TARGET": wid},
    })
    if err:
        ctx.warn("could not open picker popup: %s. "
                 "Use `apply-identity --workspace %s --colour blue` instead."
                 % (err, wid))
        return 1
    return 0


def cmd_apply_identity(argv):
    """Non-interactive identity setter (also used by the picker).

    A Space's identity is just a colour: the sidebar dot and the chrome tint are
    both derived from it.
    """
    args = _parse_kv(argv)
    wid = args.get("workspace") or _context_workspace_id()
    if not wid:
        ctx.warn("no workspace specified")
        return 1
    if args.get("emoji"):
        ctx.warn("--emoji is no longer used; identity is a colour and the sidebar "
                 "marker is a dot in that colour (set `marker` in settings.json "
                 "to change the glyph). Ignoring it.")
    colour_in = args.get("colour") or args.get("color")
    with ctx.Lock():
        st = state_mod.load()
        current = state_mod.identity_of(st, wid) or {}
        colour = current.get("colour")
        if colour_in:
            colour = ident.resolve_colour(colour_in)
            if not colour:
                ctx.warn("%r is not a palette name (%s) or a #rrggbb hex colour"
                         % (colour_in, ", ".join(ident.SLOT_NAMES)))
                return 1
        if not colour:
            colour = ident.allocate(st, wid, rpc.workspaces())["colour"]
        state_mod.set_identity(st, wid, colour, origin="manual")

        workspaces = rpc.workspaces()
        metadata.publish_workspace(wid, colour)
        for a in rpc.agents():
            if a.get("workspace_id") == wid:
                metadata.republish_pane(st, a["pane_id"], workspaces)
        slot = ident.slot_for_colour(colour)
        ctx.log("identity for %s set to %s (slot %s)"
                % (wid, ident.colour_name(colour), slot))
        if st.get("tint_enabled") and \
                (rpc.focused_workspace() or {}).get("workspace_id") == wid:
            st["last_tint"] = None          # force recompute
            _apply_tint(st, wid)
            _set_window_title(st, _label_for(wid, workspaces), ctx.settings())
        state_mod.save(st)
        note = ""
        if not ident.is_exact_palette_colour(colour):
            note = ("  (custom hex: tint uses it exactly; the sidebar dot borrows "
                    "the nearest palette slot, %s)" % slot)
        print("%s -> %s %s%s" % (wid, metadata.marker(), colour, note))
    return 0


def _parse_kv(argv):
    out = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            key = a[2:]
            if "=" in key:
                k, v = key.split("=", 1)
                out[k] = v
            elif i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[key] = argv[i + 1]
                i += 1
            else:
                out[key] = "true"
        elif "=" in a and not a.startswith("-"):
            k, v = a.split("=", 1)
            if k:
                out[k] = v
        i += 1
    return out


def cmd_tint_enable(argv):
    force = "--force" in argv
    with ctx.Lock():
        st = state_mod.load()
        st["tint_enabled"] = True
        w = rpc.focused_workspace()
        if not w:
            state_mod.save(st)
            print("tint enabled (no focused workspace yet)")
            return 0
        status, values = _apply_tint(st, w["workspace_id"], force=force)
        info = state_mod.identity_of(st, w["workspace_id"])
        if status in ("applied", "noop"):
            _set_window_title(st, w.get("label") or w["workspace_id"],
                              ctx.settings())
        state_mod.save(st)
        print("tint enabled; %s for %s" % (status, w["workspace_id"]))
    return 0 if status != "skip" else 1


def cmd_tint_disable(argv):
    force = "--force" in argv
    with ctx.Lock():
        st = state_mod.load()
        st["tint_enabled"] = False
        doc = cp.load_doc()
        restored, skipped = _restore_theme(st, doc, force=force)
        if restored:
            try:
                cp.commit(doc)
            except cp.ConfigError as exc:
                ctx.warn(str(exc))
                state_mod.save(st)
                return 1
            for key in (st.get("theme_backup") or {}).get("keys", {}):
                if key not in skipped:
                    st.get("last_written", {}).pop(key, None)
            st["theme_backup"] = None
            st["last_tint"] = None
            _reload_config()
            ctx.log("theme restored (%d keys)" % len(restored))
        _clear_window_title(st)
        state_mod.save(st)
        print("tint disabled; restored %d keys%s"
              % (len(restored), (", skipped %d" % len(skipped)) if skipped else ""))
    return 0


def cmd_theme_restore(argv):
    return cmd_tint_disable(argv)


def cmd_sidebar_install(argv):
    with ctx.Lock():
        st = state_mod.load()
        doc = cp.load_doc()
        cp.snapshot()
        backup, changes = cp.install_sidebar(doc)
        if st.get("sidebar_backup") is None:
            st["sidebar_backup"] = backup
        if st.get("ownership_baseline") is None:
            st["ownership_baseline"] = backup
        if not changes:
            st["sidebar_installed"] = True
            st.setdefault("last_written", {}).update(cp.current_owned_sidebar(doc))
            state_mod.save(st)
            print("sidebar already carries the plugin templates; nothing to do")
            return 0
        try:
            cp.commit(doc)
        except cp.ConfigError as exc:
            ctx.warn(str(exc))
            return 1
        st["sidebar_installed"] = True
        st.setdefault("last_written", {}).update(cp.current_owned_sidebar(doc))
        _reload_config()
        state_mod.save(st)
        for label, origin, rows in changes:
            ctx.log("sidebar %s (%s): %s" % (label, origin, json.dumps(rows)))
        print("installed tokens into %d row set(s)" % len(changes))
    return 0


def cmd_sidebar_remove(argv):
    force = "--force" in argv
    with ctx.Lock():
        st = state_mod.load()
        backup = st.get("sidebar_backup")
        if not backup:
            print("no sidebar backup recorded; nothing to remove")
            return 0
        doc = cp.load_doc()
        managed = set((backup.get("keys") or {}).keys())
        conflicts = cp.detect_conflicts(doc, st.get("last_written"), only_keys=managed)
        skip = set()
        if conflicts and not force:
            for key, exp, act in conflicts:
                ctx.warn("%s changed outside the plugin; leaving it alone "
                         "(--force to restore). plugin wrote %r, found %r"
                         % (key, exp, act))
                skip.add(key)
        restored = cp.restore_backup(
            doc, backup, skip=skip, tidy_tables=cp.SIDEBAR_TIDY_TABLES)
        try:
            cp.commit(doc)
        except cp.ConfigError as exc:
            ctx.warn(str(exc))
            return 1
        for key in managed:
            if key not in skip:
                st.get("last_written", {}).pop(key, None)
        st["sidebar_backup"] = None
        st["sidebar_installed"] = False
        _reload_config()
        state_mod.save(st)
        ctx.log("sidebar tokens removed (%d entries)" % len(restored))
        print("restored %d row set(s)" % len(restored))
    return 0


DEFAULT_KEYBIND = "prefix+i"
PICKER_COMMAND = "%s.set-identity" % ctx.PLUGIN_ID


MARKER_PRESETS = {
    "dot":   "\u25cf",      # ●
    "ring":  "\u25c9",      # ◉
    "square": "\u25a0",     # ■
    "bar":   "\u258a",      # ▊
    "wide":  "\u258a\u258a",  # ▊▊
    "block": "\u2588",      # █
}


def _reapply_everything(st, note=""):
    """Republish metadata and recompute the tint after a presentation change."""
    workspaces = rpc.workspaces()
    metadata.reconcile(st, workspaces, quiet=True)
    if st.get("tint_enabled"):
        w = rpc.focused_workspace()
        if w:
            st["last_tint"] = None          # force recompute
            status, _ = _apply_tint(st, w["workspace_id"], workspaces=workspaces)
            if status in ("applied", "noop"):
                _set_window_title(st, w.get("label") or w["workspace_id"],
                                  ctx.settings())
            return status
    return "metadata-only"


def cmd_repalette(argv):
    """Snap every Space to its nearest colour in the current palette.

    Useful after the palette changes: a colour that is no longer a palette member
    has no pre-styled sidebar slot of its own, so its dot would borrow a
    neighbour's slot and could collide with another Space.
    """
    dry = "--dry-run" in argv
    with ctx.Lock():
        st = state_mod.load()
        workspaces = rpc.workspaces()
        live = {w["workspace_id"]: (w.get("label") or w["workspace_id"])
                for w in workspaces}
        moves = []
        for wid, info in sorted((st.get("identities") or {}).items()):
            old = info.get("colour")
            if not old or ident.is_exact_palette_colour(old):
                continue
            slot = ident.slot_for_colour(old)
            new = ident.PALETTE_BY_NAME[slot]
            moves.append((wid, live.get(wid, "(closed)"), old, new, slot))
        if not moves:
            print("every Space already uses a current palette colour")
            return 0
        for wid, label, old, new, slot in moves:
            print("  %-4s %-18s %s -> %s (%s)" % (wid, label[:18], old, new, slot))
            if not dry:
                info = st["identities"][wid]
                info["colour"] = new
                info["origin"] = "auto"
        if dry:
            print("\n(dry run -- nothing changed)")
            return 0
        # resolve any collision the snap created
        for a, b, d in ident.close_pairs(st, workspaces):
            ctx.log("colours for %s and %s are close (%.0f); reallocating %s"
                    % (a, b, d, b))
            st["identities"].pop(b, None)
            ident.ensure_all(st, workspaces)
        _reapply_everything(st)
        state_mod.save(st)
        print("\nremapped %d Space(s)" % len(moves))
    return 0


def cmd_intensity(argv):
    """Set how strongly the Space colour shows in Herdr's chrome."""
    args = [a for a in argv if not a.startswith("-")]
    if not args:
        st_now = ctx.settings()
        print("intensity: %s (overlays %s)"
              % (theme_mod.intensity_name(st_now),
                 "on" if theme_mod.resolve_overlays(st_now) else "off"))
        print("choose one of: %s" % ", ".join(theme_mod.INTENSITY))
        return 0
    name = args[0].strip().lower()
    if name not in theme_mod.INTENSITY:
        ctx.warn("unknown intensity %r; choose one of: %s"
                 % (name, ", ".join(theme_mod.INTENSITY)))
        return 1
    with ctx.Lock():
        ctx.save_settings({"intensity": name})
        st = state_mod.load()
        status = _reapply_everything(st)
        state_mod.save(st)
    settings = ctx.settings()
    print("intensity: %s (border/separator tint %s) -> %s"
          % (name, "on" if theme_mod.resolve_overlays(settings) else "off", status))
    _print_preview(settings)
    return 0


def cmd_marker(argv):
    """Set the glyph drawn in the Space colour."""
    args = [a for a in argv if not a.startswith("-")]
    if not args:
        print("marker: %r" % metadata.marker())
        for name, glyph in MARKER_PRESETS.items():
            print("  %-7s %s" % (name, glyph))
        return 0
    raw = args[0]
    glyph = MARKER_PRESETS.get(raw.strip().lower(), raw)
    if len(glyph) > 8:
        ctx.warn("marker %r is too long; keep it to a couple of cells" % glyph)
        return 1
    with ctx.Lock():
        ctx.save_settings({"marker": glyph})
        st = state_mod.load()
        _reapply_everything(st)
        state_mod.save(st)
    print("marker: %s  (republished to every Space and Agent row)" % glyph)
    return 0


def cmd_announce(argv):
    """Toggle the per-Space toast shown on a genuine Space change."""
    args = [a for a in argv if not a.startswith("-")]
    want = True
    if args:
        want = args[0].strip().lower() in ("on", "true", "yes", "1", "enable")
    with ctx.Lock():
        ctx.save_settings({"announce": want})
        print("announce: %s" % ("on" if want else "off"))
        if want:
            doc = cp.load_doc()
            delivery = doc.get(("ui", "toast", "delivery"))
            if delivery is MISSING or delivery == "off":
                print("\nNote: herdr's own toast delivery is %s, so nothing will be\n"
                      "shown yet. Enable it yourself (this is your setting, so the\n"
                      "plugin will not change it):\n\n"
                      "  [ui.toast]\n  delivery = \"herdr\"\n"
                      % ("unset (defaults to off)" if delivery is MISSING
                         else '"off"'))
    return 0


def _print_preview(settings=None):
    """Render the generated surfaces as ANSI blocks for the focused Space."""
    settings = settings or ctx.settings()
    st = state_mod.load()
    w = rpc.focused_workspace()
    if not w:
        return
    info = state_mod.identity_of(st, w["workspace_id"])
    if not info:
        return
    doc = cp.load_doc()
    theme_name = _theme_name(doc)
    base = theme_mod.resolve_base(theme_name, settings)
    order = ["theme.custom.panel_bg", "theme.custom.surface_dim",
             "theme.custom.surface0", "theme.custom.surface1",
             "theme.custom.overlay0", "theme.custom.overlay1"]
    print("\n%s  %s   base %s %s"
          % (w.get("label"), ident.colour_name(info["colour"]),
             base, theme_mod.swatch(base, 4)))
    for name in sorted(theme_mod.INTENSITY,
                       key=lambda n: theme_mod.INTENSITY[n]["surface1"]):
        trial = dict(settings)
        trial["intensity"] = name
        trial["blend"] = {}
        vals = theme_mod.generate(info["colour"], theme_name, trial)
        cells = "".join(theme_mod.swatch(vals[k], 5) + " "
                        for k in order if k in vals)
        mark = "*" if name == theme_mod.intensity_name(settings) else " "
        print(" %s %-7s %s" % (mark, name, cells))
    print("   %-7s %s accent" % ("", theme_mod.swatch(info["colour"], 5)))
    print("   panel_bg surf_dim surface0 surface1 overlay0 overlay1"
          "   (* = active)")


def cmd_preview(argv):
    _print_preview()
    return 0


def cmd_keybind_install(argv):
    args = _parse_kv(argv)
    key = args.get("key") or DEFAULT_KEYBIND
    with ctx.Lock():
        st = state_mod.load()
        doc = cp.load_doc()
        cp.snapshot()
        status, bound = cp.install_keybind(
            doc, key, PICKER_COMMAND, "Mosaic: set Space colour")
        if status == "exists":
            print("already bound to %s (leaving your choice alone); "
                  "edit config.toml to change it" % bound)
            st["keybind_installed"] = True
            st["keybind_key"] = bound
            state_mod.save(st)
            return 0
        if status == "occupied":
            print("key %s is already bound to %s; not adding a second binding. "
                  "Use keybind-install --key <other>." % (key, bound))
            state_mod.save(st)
            return 0
        try:
            cp.commit(doc)
        except cp.ConfigError as exc:
            ctx.warn(str(exc))
            return 1
        st["keybind_installed"] = True
        st["keybind_key"] = key
        state_mod.save(st)
        _reload_config()
        ctx.log("keybinding installed: %s -> %s" % (key, PICKER_COMMAND))
        prefix_hint = ("  (prefix is ctrl+b unless you changed keys.prefix)"
                       if key.startswith("prefix+") else "")
        print("bound %s to the identity picker%s" % (key, prefix_hint))
    return 0


def cmd_keybind_remove(argv):
    with ctx.Lock():
        st = state_mod.load()
        doc = cp.load_doc()
        if not cp.remove_keybind(doc, PICKER_COMMAND):
            print("no plugin keybinding found")
            st["keybind_installed"] = False
            state_mod.save(st)
            return 0
        try:
            cp.commit(doc)
        except cp.ConfigError as exc:
            ctx.warn(str(exc))
            return 1
        st["keybind_installed"] = False
        st["keybind_key"] = None
        state_mod.save(st)
        _reload_config()
        ctx.log("keybinding removed")
        print("keybinding removed")
    return 0


def cmd_view(argv):
    mode = "current" if (argv and argv[0] == "current") else "all"
    with ctx.Lock():
        st = state_mod.load()
        res, err = agent_view.install(mode)
        if err:
            ctx.warn("agent view failed: %s" % err)
            return 1
        st["view_installed"] = True
        st["view_mode"] = mode
        state_mod.save(st)
        ctx.log("agent view installed (%s)" % mode)
        print("agent view: %s (%s)" % (mode, (res or {}).get("label")))
    return 0


def cmd_view_clear(argv):
    with ctx.Lock():
        st = state_mod.load()
        if not st.get("view_installed"):
            print("this plugin does not own an agent view; leaving it alone")
            return 0
        _, err = agent_view.clear()
        if err:
            ctx.warn("agent view clear failed: %s" % err)
            return 1
        st["view_installed"] = False
        state_mod.save(st)
        ctx.log("agent view cleared")
        print("agent view cleared")
    return 0


def cmd_picker(argv):
    import picker
    return picker.run(argv)


def cmd_board_open(argv):
    """Open the Agent Board as a plugin pane."""
    _, err = rpc.try_call("plugin.pane.open", {
        "plugin_id": ctx.PLUGIN_ID,
        "entrypoint": "board",
        "focus": True,
    })
    if err:
        ctx.warn("could not open agent board: %s" % err)
        return 1
    return 0


def cmd_board(argv):
    import board
    return board.run(argv)


# --------------------------------------------------------------------------
# doctor
# --------------------------------------------------------------------------

def _running_sessions():
    import subprocess
    try:
        proc = subprocess.Popen([ctx.herdr_bin(), "session", "list", "--json"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, _ = proc.communicate(timeout=10)
        data = json.loads(out.decode("utf-8", "replace"))
        return [s for s in data.get("sessions", []) if s.get("running")]
    except Exception:
        return []


def cmd_doctor(argv):
    st = state_mod.load()
    settings = ctx.settings()
    problems = []
    out = []

    def row(k, v):
        out.append("  %-30s %s" % (k + ":", v))

    out.append("iurysza.mosaic doctor")
    out.append("")

    pong, err = rpc.try_call("ping", {})
    if err:
        out.append("  herdr server:                  UNREACHABLE (%s)" % err)
        problems.append("Herdr server not reachable on %s -- is Herdr running? "
                        "Start it with `herdr`." % ctx.socket_path())
        pong = {}
    row("herdr version", "%s (protocol %s)" % (pong.get("version", "?"),
                                               pong.get("protocol", "?")))
    row("plugin version", ctx.PLUGIN_VERSION)
    row("plugin id", ctx.PLUGIN_ID)
    cfg_path = ctx.herdr_config_path()
    row("config path", "%s%s" % (cfg_path, "" if os.path.exists(cfg_path) else " (MISSING)"))
    row("plugin config dir", ctx.config_dir())
    row("plugin state dir", ctx.state_dir())
    row("settings file", "%s%s" % (ctx.settings_path(),
                                   "" if os.path.exists(ctx.settings_path()) else " (defaults)"))

    doc = cp.load_doc()
    theme_name = _theme_name(doc)
    row("base theme", theme_name or "(herdr default)")
    row("blend base", theme_mod.resolve_base(theme_name, settings))
    if doc.get(("theme", "auto_switch")) is True:
        problems.append("theme.auto_switch is true: Herdr may swap the base theme "
                        "under the plugin's derived surfaces. Consider setting it "
                        "false while using the tint.")

    workspaces = rpc.workspaces() if not err else []
    agents = rpc.agents() if not err else []
    focused = None
    for w in workspaces:
        if w.get("focused"):
            focused = w
    row("workspaces", len(workspaces))
    row("agents", len(agents))
    if focused:
        fid = focused["workspace_id"]
        info = state_mod.identity_of(st, fid)
        row("focused workspace", "%s (%s)" % (fid, focused.get("label")))
        row("focused identity",
            "%s %s  slot=%s (%s)" % (metadata.marker(), info["colour"],
                                     ident.slot_for_colour(info["colour"]),
                                     info.get("origin"))
            if info else "NONE ASSIGNED")
        if not info:
            problems.append("Focused workspace %s has no identity. Run the "
                            "'Auto Assign Identity' action." % fid)
    else:
        row("focused workspace", "(none)")

    close = ident.close_pairs(st, workspaces) if workspaces else []
    if close:
        problems.append("Space colours that may be hard to tell apart: %s. "
                        "Run 'repalette', or set one explicitly with prefix+i."
                        % "; ".join("%s/%s (%.0f apart)" % c for c in close))

    idents = st.get("identities") or {}
    row("identities stored", len(idents))
    known = {w.get("workspace_id") for w in workspaces}
    missing = sorted(known - set(idents))
    if missing:
        problems.append("Workspaces without an identity: %s. Run 'Auto Assign "
                        "Identity'." % ", ".join(missing))

    # metadata publication status
    published = 0
    for w in workspaces:
        toks = w.get("tokens") or {}
        if any(toks.get(t) for t in ident.all_slot_tokens()):
            published += 1
    row("workspace metadata", "%d/%d published" % (published, len(workspaces)))
    if workspaces and published < len(workspaces):
        problems.append("Only %d of %d workspaces carry a space dot. "
                        "Metadata is dropped on server restart -- run the "
                        "'Reconcile' action (or restart Herdr, which triggers the "
                        "startup hook)." % (published, len(workspaces)))

    pane_published = 0
    if agents:
        try:
            for a in agents:
                res, perr = rpc.try_call("pane.get", {"pane_id": a["pane_id"]})
                if perr:
                    continue
                pane = (res or {}).get("pane") or {}
                ptoks = pane.get("tokens") or {}
                if any(ptoks.get(t) for t in ident.all_slot_tokens()):
                    pane_published += 1
        except Exception:
            pass
    row("agent pane metadata", "%d/%d published" % (pane_published, len(agents)))

    # sidebar
    row("sidebar tokens installed", st.get("sidebar_installed") and "yes" or "no")
    for path, _d, label in cp.sidebar_targets(doc):
        cur = doc.get(path)
        if cur is MISSING:
            row("  " + label, "(not set)")
            continue
        names = [cp._token_name(e) for r in cur for e in r]
        if label == "ui.sidebar.agents.rows":
            count = len(cur[0]) if cur else 0
            if cp.has_dots(cur):
                status = "HAS SPACE DOTS (bad)"
                problems.append(
                    "Agents row still has $sd_* tokens. Re-run install; do not "
                    "add space dots to the 15-token title row (Herdr max 16).")
            elif cp.has_agent_template(cur):
                status = "OK %d tokens" % count
            else:
                status = "NOT PLUGIN TEMPLATE"
                problems.append(
                    "Agents row is not the elapsed/title/tier template. Run install.")
            if count > cp.MAX_TOKENS_PER_ROW:
                problems.append("Agents row has %d tokens; Herdr max is %d." % (
                    count, cp.MAX_TOKENS_PER_ROW))
            row("  " + label, "%s  %s" % (status, " ".join(tok for tok in names if tok)))
        elif label.startswith("ui.sidebar.agents.rows_by_agent."):
            row("  " + label, "preserved  %s" % " ".join(n for n in names if n))
            problems.append(
                "%s fully replaces ui.sidebar.agents.rows for that agent, so it "
                "will not show the elapsed/title/tier template. This plugin does "
                "not rewrite rows_by_agent." % label)
        else:
            row("  " + label, "%s  %s" % (
                "OK" if cp.has_dots(cur) else "NO DOT",
                " ".join(n for n in names if n)))
    if doc.get(("ui", "agent_panel_sort")) == "priority":
        problems.append("ui.agent_panel_sort is \"priority\". The plugin's agent "
                        "view sorts by space; if the Agents panel still shows an "
                        "attention queue, set ui.agent_panel_sort = \"spaces\".")

    bound = cp.keybind_key(doc, PICKER_COMMAND)
    row("picker keybinding", bound if bound else "not bound "
        "(run the 'Bind Picker Key' action)")

    # agent view
    row("agent view owned", st.get("view_installed") and
        ("yes (%s)" % st.get("view_mode")) or "no")
    out.append("  %-30s %s" % ("agent view readback:",
                               "unavailable -- herdr 0.8.0 has no agent.view.get"))

    # tint
    row("tint enabled", st.get("tint_enabled") and "yes" or "no")
    row("intensity", "%s" % theme_mod.intensity_name(settings))
    row("tint overlays", theme_mod.resolve_overlays(settings) and "yes" or "no")
    row("marker", "%r" % metadata.marker())
    row("space-change toast", settings.get("announce") and "on" or "off")
    last = st.get("last_tint") or {}
    row("last tinted workspace", last.get("workspace_id") or "(none)")
    if focused and st.get("tint_enabled"):
        info = state_mod.identity_of(st, focused["workspace_id"])
        if info:
            vals = theme_mod.generate(info["colour"], theme_name, settings)
            out.append("  generated theme values:")
            for k in sorted(vals):
                actual = doc.get(cp.dotted(k))
                mark = "OK " if actual == vals[k] else "DIFF"
                out.append("    %s %-28s %s (config: %s)"
                           % (mark, k, vals[k],
                              "absent" if actual is MISSING else actual))
    row("theme backup", "captured (%d keys)" % len(st["theme_backup"]["keys"])
        if st.get("theme_backup") else "none")

    # conflicts
    conflicts = cp.detect_conflicts(doc, st.get("last_written"))
    row("config conflicts", len(conflicts))
    for key, exp, act in conflicts:
        out.append("    %s: plugin wrote %r, config has %r" % (key, exp, act))
    if conflicts:
        problems.append("%d config key(s) changed outside the plugin. The plugin "
                        "will not overwrite them; pass --force to a tint/restore "
                        "action to take them over, or leave them as yours."
                        % len(conflicts))

    # Plugin-owned scheduling is independent of the old external service.
    import refresh
    import elapsed
    heartbeat = refresh.status()
    age = time.time() - heartbeat["published_at"] if heartbeat else None
    row("sidebar refresh", "last round %.1fs ago" % age if age is not None else "not running")
    if st.get("sidebar_installed") and (age is None or age > elapsed.TTL_MS / 1000.0):
        problems.append("Mosaic sidebar refresh is missing or stale. Run reconcile "
                        "and inspect refresh.log in the plugin state directory.")

    # sessions
    running = _running_sessions()
    row("herdr sessions running", "%d (%s)" % (len(running),
                                               ", ".join(s["name"] for s in running)))
    if len(running) > 1:
        problems.append("More than one Herdr session is running. config.toml is "
                        "GLOBAL across sessions (there is no per-session config), "
                        "so each session's workspace.focused hook writes the same "
                        "theme keys and they will fight. Use the dynamic tint with "
                        "a single active session.")

    # config validity
    ok, vout = cp.validate(doc.dumps())
    row("config validates", "yes" if ok else "NO -- %s" % vout)
    if not ok:
        problems.append("Current config does not pass `herdr config check`: %s" % vout)

    out.append("")
    if problems:
        out.append("Problems (%d):" % len(problems))
        for i, p in enumerate(problems, 1):
            out.append("  %d. %s" % (i, p))
    else:
        out.append("No problems found.")
    sys.stdout.write("\n".join(out) + "\n")
    return 0


# --------------------------------------------------------------------------
# uninstall
# --------------------------------------------------------------------------

def cmd_uninstall(argv):
    """Undo everything this plugin installed, in one validated config write."""
    force = "--force" in argv
    with ctx.Lock():
        st = state_mod.load()
        cp.snapshot()
        doc = cp.load_doc()
        notes = []
        action_renames = st.get("action_renames") or []
        migrated_picker = any(record["command"] == PICKER_COMMAND for record in action_renames)
        remaining_renames = cp.restore_action_renames(doc, action_renames)
        if remaining_renames:
            notes.append("action bindings skipped (user-modified): %s" %
                         ", ".join(record["key"] for record in remaining_renames))

        restored, skipped = _restore_theme(st, doc, force=force)
        if restored:
            notes.append("theme: %d keys" % len(restored))
        if skipped:
            notes.append("theme skipped (user-modified): %s" % ", ".join(skipped))

        sb = st.get("sidebar_backup")
        if sb:
            managed = set((sb.get("keys") or {}).keys())
            conflicts = cp.detect_conflicts(doc, st.get("last_written"),
                                            only_keys=managed)
            sskip = set()
            if conflicts and not force:
                for key, exp, act in conflicts:
                    ctx.warn("%s changed outside the plugin; leaving it alone "
                             "(--force to restore). plugin wrote %r, found %r"
                             % (key, exp, act))
                    sskip.add(key)
            sres = cp.restore_backup(
                doc, sb, skip=sskip, tidy_tables=cp.SIDEBAR_TIDY_TABLES)
            notes.append("sidebar: %d row sets" % len(sres))

        if not migrated_picker and cp.remove_keybind(doc, PICKER_COMMAND):
            notes.append("keybinding removed")
        st["keybind_installed"] = False
        st["keybind_key"] = None

        try:
            cp.commit(doc)
        except cp.ConfigError as exc:
            ctx.warn("config restore failed, nothing written: %s" % exc)
            return 1

        if st.get("view_installed"):
            _, err = agent_view.clear()
            if err:
                ctx.warn("agent view clear failed: %s" % err)
            else:
                notes.append("agent view cleared")
            st["view_installed"] = False

        for w in rpc.workspaces():
            metadata.clear_workspace(w["workspace_id"])
        agents = rpc.agents()
        for a in agents:
            metadata.clear_pane(a["pane_id"])
        import sidebar
        sidebar.clear(agents)
        notes.append("metadata cleared")

        _clear_window_title(st)
        _reload_config()

        st["theme_backup"] = None
        st["sidebar_backup"] = None
        st["ownership_baseline"] = None
        st["sidebar_installed"] = False
        st["tint_enabled"] = False
        st["last_tint"] = None
        st["last_written"] = {}
        st["action_renames"] = remaining_renames
        state_mod.save(st)
        ctx.log("uninstall complete: %s" % "; ".join(notes))
        print("restored. %s" % "; ".join(notes))
        print("\nIdentities are kept in %s so relinking restores them.\n"
              "Now run:  herdr plugin unlink %s" % (ctx.state_dir(), ctx.PLUGIN_ID))
    return 0


def cmd_migrate(argv):
    """Import Window Manager data or compatible parts of older plugins."""
    import migrate
    with ctx.Lock():
        try:
            return migrate.run(argv)
        except (migrate.MigrationError, OSError) as exc:
            ctx.warn(str(exc))
            print(str(exc), file=sys.stderr)
            return 1


def cmd_layout(argv):
    import layout_actions
    return layout_actions.run(argv)


def cmd_install(argv):
    """One-shot local setup: migrate + sidebar templates + agent view + reconcile."""
    if "--dry-run" in argv:
        print("install --dry-run only previews migrate; "
              "sidebar, keybind, and view are not written")
        return cmd_migrate(argv)
    rc = cmd_migrate(argv)
    if rc:
        return rc
    for command in (cmd_sidebar_install, cmd_keybind_install):
        rc = command(argv)
        if rc:
            return rc
    with ctx.Lock():
        import migrate
        st = state_mod.load()
        doc = cp.load_doc()
        records = cp.rename_plugin_actions(doc, migrate.LEGACY_WINDOW_MANAGER_ID, ctx.PLUGIN_ID)
        if records:
            cp.snapshot()
            saved = st.setdefault("action_renames", [])
            for record in records:
                previous = next((item for item in saved if item["key"] == record["key"]
                                 and item["command"] == record["command"]), None)
                if previous is None:
                    saved.append(record)
                elif previous != record:
                    raise cp.ConfigError("binding %s changed since migration; not overwriting" % record["key"])
            state_mod.save(st)  # Restore records must survive a failed config write.
            cp.commit(doc)
            _reload_config()
    mode = state_mod.load().get("view_mode") or "all"
    if mode not in ("all", "current"):
        mode = "all"
    rc = cmd_view([mode])
    return rc if rc else cmd_reconcile(argv)


def cmd_list(argv):
    """Show current Space identities and the assignable colours."""
    st = state_mod.load()
    workspaces = rpc.workspaces()
    m = metadata.marker()
    print("Spaces")
    for w in sorted(workspaces, key=lambda x: (x.get("number") or 0)):
        wid = w["workspace_id"]
        i = state_mod.identity_of(st, wid) or {}
        col = i.get("colour")
        print("  %-4s %-18s %s %-9s %-8s %s%s"
              % (wid, (w.get("label") or "")[:18], m if col else "-",
                 ident.colour_name(col) if col else "-",
                 col or "", i.get("origin") or "unassigned",
                 "   <- focused" if w.get("focused") else ""))
    print("\nPalette (a Space's colour sets both its dot and its chrome tint)")
    for name, hexv in ident.PALETTE:
        print("  %s  %-8s %s" % (m, name, hexv))
    print("\nAny #rrggbb also works: the tint uses it exactly, and the dot")
    print("borrows the nearest palette slot (only palette slots can be")
    print("pre-styled in config, so only they have a real colour of their own).")
    print("\nSet with:")
    print("  prefix+i                                    # picker popup")
    print("  /usr/bin/python3 %s/src/main.py apply-identity "
          "--workspace <id> --colour <name|hex>" % ctx.plugin_root())
    return 0


def cmd_elapsed_publish(argv):
    import elapsed
    return elapsed.publish()


def cmd_refresh_worker(argv):
    import refresh
    if len(argv) != 1:
        raise RuntimeError("refresh-worker requires the socket generation from startup")
    return refresh.run(argv[0])


def cmd_state(argv):
    sys.stdout.write(json.dumps(state_mod.load(), indent=2, ensure_ascii=False,
                                sort_keys=True) + "\n")
    return 0


COMMANDS = {
    "reconcile": cmd_reconcile,
    "event": cmd_event,
    "install": cmd_install,
    "migrate": cmd_migrate,
    "layout": cmd_layout,
    "set-identity": cmd_set_identity,
    "apply-identity": cmd_apply_identity,
    "auto-assign": cmd_auto_assign,
    "tint-enable": cmd_tint_enable,
    "tint-disable": cmd_tint_disable,
    "theme-restore": cmd_theme_restore,
    "sidebar-install": cmd_sidebar_install,
    "sidebar-remove": cmd_sidebar_remove,
    "repalette": cmd_repalette,
    "intensity": cmd_intensity,
    "marker": cmd_marker,
    "announce": cmd_announce,
    "preview": cmd_preview,
    "keybind-install": cmd_keybind_install,
    "keybind-remove": cmd_keybind_remove,
    "view": cmd_view,
    "view-clear": cmd_view_clear,
    "picker": cmd_picker,
    "board": cmd_board,
    "board-open": cmd_board_open,
    "doctor": cmd_doctor,
    "uninstall": cmd_uninstall,
    "list": cmd_list,
    "state": cmd_state,
    "elapsed-publish": cmd_elapsed_publish,
    "refresh-worker": cmd_refresh_worker,
}


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        sys.stdout.write("usage: main.py <%s> [args]\n"
                         % "|".join(sorted(COMMANDS)))
        return 0
    cmd = argv[0]
    fn = COMMANDS.get(cmd)
    if not fn:
        sys.stderr.write("unknown command %r\n" % cmd)
        return 2
    # An old registry entry can still point at a checkout after a git update.
    # Never run Mosaic hooks against Window Manager's environment or data paths.
    registered_id = os.environ.get("HERDR_PLUGIN_ID")
    if registered_id and registered_id != ctx.PLUGIN_ID:
        sys.stderr.write("Mosaic cannot run as %s; follow docs/migration.md "
                         "before relinking this checkout\n" % registered_id)
        return 1
    import migrate
    if cmd not in ("migrate", "install") and migrate.window_manager_pending():
        sys.stderr.write("Window Manager data awaits import; follow docs/migration.md "
                         "and run Mosaic's migrate action before %s\n" % cmd)
        return 1
    try:
        result = fn(argv[1:]) or 0
        refresh_events = ("tab.renamed", "pane.agent_detected", "pane.moved",
                          "pane.agent_status_changed")
        refresh_needed = (cmd in ("install", "reconcile", "apply-identity", "repalette")
                          or (cmd == "event" and len(argv) > 1 and argv[1] in refresh_events))
        if result == 0 and refresh_needed and "--dry-run" not in argv:
            import sidebar
            import refresh
            sidebar.publish_once()
            refresh.start()
        return result
    except OSError as exc:
        ctx.warn("I/O error in %s: %s" % (cmd, exc))
        return 1
    except rpc.RpcError as exc:
        ctx.warn("herdr API error in %s: %s" % (cmd, exc))
        return 1
    except cp.ConfigError as exc:
        ctx.warn("config error in %s: %s" % (cmd, exc))
        return 1
    except RuntimeError as exc:
        ctx.warn("%s: %s" % (cmd, exc))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
