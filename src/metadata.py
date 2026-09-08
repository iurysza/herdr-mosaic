"""Publish Space identity as Herdr workspace/pane metadata.

Each palette slot has its own pre-styled sidebar token. For a given Space we
publish the marker glyph on the one slot token matching its colour and clear the
rest, so exactly one coloured dot renders per row.

Metadata is runtime-only and does not survive a Herdr server restart. The
plugin's state file is the source of truth; `reconcile` republishes from it.
"""

import ctx
import identity as ident
import labels as label_rules
import rpc
import state as state_mod

SOURCE = ctx.PLUGIN_ID

NAME_TOKEN = "space_name"
COLOUR_TOKEN = "space_colour"
LEGACY_EMOJI_TOKEN = "space_emoji"    # cleared on migration


def marker():
    return ctx.settings().get("marker") or ident.DEFAULT_MARKER


def workspace_id_of_pane(pane_id):
    """`wF:p2` -> `wF`."""
    return (pane_id or "").split(":", 1)[0] or None


def _dot_tokens(colour, glyph=None):
    """{slot_token: glyph-or-None} with only the matching slot set."""
    glyph = glyph or marker()
    active = ident.slot_token(ident.slot_for_colour(colour))
    out = {}
    for tok in ident.all_slot_tokens():
        out[tok] = glyph if tok == active else None
    return out


def publish_workspace(workspace_id, colour):
    tokens = _dot_tokens(colour)
    tokens[COLOUR_TOKEN] = colour
    tokens[LEGACY_EMOJI_TOKEN] = None
    return rpc.try_call("workspace.report_metadata", {
        "workspace_id": workspace_id,
        "source": SOURCE,
        "tokens": tokens,
    })


def publish_pane(pane_id, colour, space_name):
    tokens = _dot_tokens(colour)
    tokens[NAME_TOKEN] = space_name
    tokens[LEGACY_EMOJI_TOKEN] = None
    return rpc.try_call("pane.report_metadata", {
        "pane_id": pane_id,
        "source": SOURCE,
        "tokens": tokens,
    })


def _cleared():
    out = {tok: None for tok in ident.all_slot_tokens()}
    out[NAME_TOKEN] = None
    out[COLOUR_TOKEN] = None
    out[LEGACY_EMOJI_TOKEN] = None
    return out


def clear_workspace(workspace_id):
    return rpc.try_call("workspace.report_metadata", {
        "workspace_id": workspace_id, "source": SOURCE, "tokens": _cleared()})


def clear_pane(pane_id):
    return rpc.try_call("pane.report_metadata", {
        "pane_id": pane_id, "source": SOURCE, "tokens": _cleared()})


def reconcile(st, workspaces=None, agents=None, quiet=False):
    """Republish all workspace and agent-pane metadata from durable state."""
    workspaces = rpc.workspaces() if workspaces is None else workspaces
    agents = rpc.agents() if agents is None else agents

    label_rules.apply(st, workspaces)
    added = ident.ensure_all(st, workspaces)

    space_labels = {}
    ws_ok = ws_fail = 0
    for w in workspaces:
        wid = w.get("workspace_id")
        if not wid:
            continue
        space_labels[wid] = w.get("label") or wid
        info = state_mod.identity_of(st, wid)
        if not info or not info.get("colour"):
            continue
        _, err = publish_workspace(wid, info["colour"])
        if err:
            ws_fail += 1
            ctx.warn("workspace metadata failed for %s: %s" % (wid, err))
        else:
            ws_ok += 1

    pane_ok = pane_fail = 0
    for a in agents:
        pane_id = a.get("pane_id")
        wid = a.get("workspace_id") or workspace_id_of_pane(pane_id)
        info = state_mod.identity_of(st, wid) if wid else None
        if not pane_id or not info or not info.get("colour"):
            continue
        _, err = publish_pane(pane_id, info["colour"], space_labels.get(wid, wid))
        if err:
            pane_fail += 1
            ctx.warn("pane metadata failed for %s: %s" % (pane_id, err))
        else:
            pane_ok += 1

    summary = {
        "workspaces": ws_ok, "workspaces_failed": ws_fail,
        "panes": pane_ok, "panes_failed": pane_fail,
        "identities_assigned": added,
    }
    if not quiet:
        msg = "metadata reconciled: %d workspaces, %d agent panes" % (ws_ok, pane_ok)
        if added:
            msg += "; assigned identity to %s" % ", ".join(added)
        if ws_fail or pane_fail:
            msg += " (%d workspace / %d pane failures)" % (ws_fail, pane_fail)
        ctx.log(msg)
    return summary


def republish_pane(st, pane_id, workspaces=None):
    """Refresh one pane after it moved or an agent appeared in it."""
    wid = workspace_id_of_pane(pane_id)
    if not wid:
        return False
    info = state_mod.identity_of(st, wid)
    if not info or not info.get("colour"):
        return False
    workspaces = rpc.workspaces() if workspaces is None else workspaces
    label = wid
    for w in workspaces:
        if w.get("workspace_id") == wid:
            label = w.get("label") or wid
            break
    _, err = publish_pane(pane_id, info["colour"], label)
    if err:
        ctx.warn("pane metadata failed for %s: %s" % (pane_id, err))
        return False
    return True
