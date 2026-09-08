"""Portable workspace label → colour rules.

Chromatic itself stored identities by workspace id. Personal setups also keep a
version-1 JSON map of labels to colours (chromatic-spaces-identities.json). This
module reads that map and applies it to matching live labels without writing the
source file.
"""

import json
import os

import ctx
import identity as ident
import state as state_mod


class LabelRulesError(ValueError):
    pass


def _legacy_identities_path():
    return os.path.join(
        os.path.dirname(ctx.herdr_config_path()),
        "chromatic-spaces-identities.json",
    )


def rules_path():
    env = os.environ.get("HERDR_LABEL_IDENTITIES_FILE")
    if env:
        return env
    settings = ctx.settings()
    configured = settings.get("label_identities_file")
    if configured:
        return configured
    plugin_path = os.path.join(ctx.config_dir(), "identities.json")
    if os.path.exists(plugin_path):
        return plugin_path
    legacy = _legacy_identities_path()
    if os.path.exists(legacy):
        return legacy
    return plugin_path


def _load_file(path):
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (ValueError, OSError) as exc:
        raise LabelRulesError("unreadable label identities file %s: %s" % (path, exc))
    if not isinstance(data, dict) or data.get("version") != 1:
        raise LabelRulesError(
            "label identities %s must be version 1 with an identities object" % path
        )
    raw = data.get("identities")
    if not isinstance(raw, dict):
        raise LabelRulesError("label identities %s missing identities object" % path)
    out = {}
    for label, colour in raw.items():
        if not isinstance(label, str) or not label or not isinstance(colour, str) or not colour:
            raise LabelRulesError("invalid label identity entry in %s" % path)
        resolved = ident.resolve_colour(colour)
        if not resolved:
            raise LabelRulesError(
                "label %r colour %r is not a palette name or #rrggbb" % (label, colour)
            )
        out[label] = resolved
    return out


def load_rules():
    """File rules first, then optional settings overlay."""
    rules = _load_file(rules_path())
    inline = ctx.settings().get("label_identities") or {}
    if not isinstance(inline, dict):
        raise LabelRulesError("settings.label_identities must be an object")
    for label, colour in inline.items():
        if not isinstance(label, str) or not label:
            continue
        resolved = ident.resolve_colour(colour) if isinstance(colour, str) else None
        if not resolved:
            ctx.warn("ignoring invalid settings label identity %r -> %r" % (label, colour))
            continue
        rules[label] = resolved
    return rules


def apply(st, workspaces):
    """Assign colours for matching labels unless the user set them manually.

    Returns workspace ids that changed.
    """
    try:
        rules = load_rules()
    except LabelRulesError as exc:
        ctx.warn(str(exc))
        return []
    if not rules:
        return []
    changed = []
    for w in workspaces or []:
        wid = w.get("workspace_id")
        label = w.get("label")
        if not wid or not label or label not in rules:
            continue
        colour = rules[label]
        current = state_mod.identity_of(st, wid) or {}
        if current.get("origin") == "manual":
            continue
        if current.get("colour") == colour and current.get("origin") == "label":
            continue
        state_mod.set_identity(st, wid, colour, origin="label")
        changed.append(wid)
    return changed
