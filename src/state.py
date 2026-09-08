"""Durable plugin state.

Herdr's workspace/pane metadata is runtime-only and does not survive a server
restart, so this file -- not Herdr -- is the database of record for space
identities. Startup reconciliation republishes everything from here.
"""

import json
import os

import ctx

SCHEMA_VERSION = 1


def _path():
    return os.path.join(ctx.state_dir(), "state.json")


def default_state():
    return {
        "version": SCHEMA_VERSION,
        # workspace_id -> {"colour", "origin": "auto"|"manual"|"label"}
        "identities": {},
        # rotating cursor for automatic allocation
        "alloc_cursor": 0,
        "tint_enabled": False,
        "view_mode": "all",            # "all" | "current"
        "view_installed": False,
        "sidebar_installed": False,
        # exact restore information, distinguishing absent from present-with-value
        "theme_backup": None,          # {"keys": {dotted: {"present": bool, "value": ...}}}
        "sidebar_backup": None,
        "ownership_baseline": None,    # live config snapshot at first take-ownership
        "last_written": {},            # dotted key -> value this plugin last wrote
        "last_tint": None,             # {"workspace_id", "values": {...}}
        "window_title_set": False,
        "keybind_installed": False,
        "keybind_key": None,
        # pane_id -> {"status", "last_settled_at"}; occupancy only, not last viewed
        "agent_settled": {},
    }


def load():
    path = _path()
    if not os.path.exists(path):
        return default_state()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (ValueError, OSError) as exc:
        ctx.warn("state.json unreadable (%s); starting from defaults" % exc)
        return default_state()
    if not isinstance(data, dict):
        return default_state()
    base = default_state()
    base.update(data)
    base["version"] = SCHEMA_VERSION
    if not isinstance(base.get("identities"), dict):
        base["identities"] = {}
    if not isinstance(base.get("agent_settled"), dict):
        base["agent_settled"] = {}
    _migrate(base)
    return base


def _migrate(data):
    """Bring older state up to the current identity model.

    v1 stored an emoji alongside the colour. Identity is now the colour alone, so
    the emoji field is dropped. An *auto* colour that is no longer in the palette
    is removed so it gets reallocated (it would otherwise have no pre-styled
    sidebar slot of its own); a *manual* colour is always kept, because the user
    chose it -- its dot simply borrows the nearest slot.
    """
    import identity as ident
    palette = {h for _n, h in ident.PALETTE}
    for wid, info in list((data.get("identities") or {}).items()):
        if not isinstance(info, dict):
            data["identities"].pop(wid, None)
            continue
        info.pop("emoji", None)
        colour = (info.get("colour") or "").lower()
        if not colour:
            data["identities"].pop(wid, None)
            continue
        if info.get("origin") not in ("manual", "label") and colour not in palette:
            data["identities"].pop(wid, None)


def save(data):
    ctx.atomic_write(_path(), json.dumps(data, indent=2, ensure_ascii=False,
                                        sort_keys=True) + "\n")


def identity_of(data, workspace_id):
    return (data.get("identities") or {}).get(workspace_id)


def set_identity(data, workspace_id, colour, origin="manual"):
    """A Space's identity is a colour; the dot and tint are both derived from it."""
    data.setdefault("identities", {})[workspace_id] = {
        "colour": colour, "origin": origin,
    }
    return data["identities"][workspace_id]
