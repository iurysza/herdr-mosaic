"""Space identity model: one colour per Space, rendered as a coloured dot.

A Space's identity is a single **colour**. Everything visible is derived from it:

* the sidebar marker is a dot drawn in that colour;
* the chrome tint accent is that colour.

Herdr's sidebar token styling is *static config* -- there is no way to colour a
row from a metadata value -- so each palette colour gets its own pre-styled
metadata token (`$sd_blue`, `$sd_purple`, ...). All slot tokens sit in the row
with their fixed `fg`, and only the one matching a Space carries a value, so
exactly one coloured dot appears per row. This is the "statically configured
metadata tokens represent palette slots" approach.

Identity is keyed on the Herdr workspace ID, so renaming a Space never changes it.
"""

import re

# Eight clearly separable hues. Bright pure red and green are excluded so a Space
# colour is never confusable with Herdr's semantic agent status colours.
# Twelve pastel hues in the register dev tooling actually uses -- drawn from
# Catppuccin, Tokyo Night, One Dark, Rose Pine, Everforest and Dracula. Ordered by
# hue so the picker reads as a colour wheel.
#
# Pastels are *safer* than saturated colours here, not just prettier: every one of
# these sits >=110 perceptual units away from gruvbox's status red/green/yellow,
# where the previous saturated palette came as close as 80. A Space colour is
# therefore harder to mistake for an Agent state.
#
# The flip side is that 12 pastels are inherently less separable than 8 saturated
# ones (they share a narrow luminance band), so `allocate` picks by maximum
# perceptual distance from the colours already in use rather than round-robin.
PALETTE = [
    ("rose",     "#eba0ac"),
    ("peach",    "#fab387"),
    ("amber",    "#e5c07b"),
    ("sage",     "#a6d189"),
    ("aqua",     "#7fd6c1"),
    ("cyan",     "#8be9fd"),
    ("steel",    "#8ca0b3"),
    ("azure",    "#7aa2f7"),
    ("lavender", "#b4befe"),
    ("mauve",    "#cba6f7"),
    ("orchid",   "#e0a3e8"),
    ("blush",    "#f5c2e7"),
]

PALETTE_BY_NAME = dict(PALETTE)
SLOT_NAMES = [name for name, _ in PALETTE]

# Metadata token per palette slot. Must satisfy ^[A-Za-z0-9_-]{1,32}$.
TOKEN_PREFIX = "sd_"

# Default marker glyph. Single-width and unambiguous; override in settings.json
# (`marker`) with e.g. "◆", "■" or "▊" if it reads too close to your state icon.
DEFAULT_MARKER = "●"          # ●

HEX_RE = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def slot_token(slot_name):
    return TOKEN_PREFIX + slot_name


def all_slot_tokens():
    return [slot_token(n) for n in SLOT_NAMES]


def normalise_hex(value):
    """Return a canonical #rrggbb string, or None if not a valid hex colour."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not HEX_RE.match(v):
        return None
    v = v.lower()
    if len(v) == 4:
        v = "#" + "".join(c * 2 for c in v[1:])
    return v


def resolve_colour(value):
    """Accept a palette name or a hex string. -> #rrggbb or None."""
    if not isinstance(value, str):
        return None
    name = value.strip().lower()
    if name in PALETTE_BY_NAME:
        return PALETTE_BY_NAME[name]
    return normalise_hex(value)


def _rgb(hexv):
    v = hexv.lstrip("#")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def slot_for_colour(colour):
    """Palette slot whose styled token should carry the dot for `colour`.

    An exact palette colour maps to its own slot. A custom hex has no pre-styled
    token of its own, so it borrows the nearest palette slot for the dot while the
    exact hex is still used for the chrome tint. Documented, not silent.
    """
    target = normalise_hex(colour)
    if not target:
        return SLOT_NAMES[0]
    for name, hexv in PALETTE:
        if hexv == target:
            return name
    tr, tg, tb = _rgb(target)
    best, best_d = SLOT_NAMES[0], None
    for name, hexv in PALETTE:
        r, g, b = _rgb(hexv)
        # weighted to approximate perceptual distance
        d = 2 * (r - tr) ** 2 + 4 * (g - tg) ** 2 + 3 * (b - tb) ** 2
        if best_d is None or d < best_d:
            best, best_d = name, d
    return best


def is_exact_palette_colour(colour):
    return normalise_hex(colour) in {h for _n, h in PALETTE}


def colour_name(colour):
    """Palette name for an exact match, else the hex itself."""
    target = normalise_hex(colour)
    for name, hexv in PALETTE:
        if hexv == target:
            return name
    return target or "?"


def distance(a, b):
    """Weighted RGB distance -- a cheap perceptual approximation."""
    ah, bh = normalise_hex(a), normalise_hex(b)
    if not ah or not bh:
        return 0.0
    ar, ag, ab = _rgb(ah)
    br, bg, bb = _rgb(bh)
    rm = (ar + br) / 2.0
    return (((2 + rm / 256.0) * (ar - br) ** 2)
            + (4 * (ag - bg) ** 2)
            + ((2 + (255 - rm) / 256.0) * (ab - bb) ** 2)) ** 0.5


# Below this, two Space colours are close enough to be worth warning about.
CLOSE_ENOUGH = 80.0


def _ordered(workspaces):
    return sorted(workspaces, key=lambda w: (w.get("number") or 0,
                                             w.get("workspace_id") or ""))


def _neighbour_colours(workspaces, identities, workspace_id):
    order = [w.get("workspace_id") for w in _ordered(workspaces)]
    if workspace_id not in order:
        return set()
    i = order.index(workspace_id)
    out = set()
    for j in (i - 1, i + 1):
        if 0 <= j < len(order):
            ident = identities.get(order[j])
            if ident and ident.get("colour"):
                out.add(ident["colour"].lower())
    return out


def allocate(state, workspace_id, workspaces):
    """Pick the palette colour most visually distinct from the ones in use.

    Neighbouring Spaces weigh double, since those are the rows the eye compares.
    With 12 pastels and a handful of Spaces this reliably spreads across the wheel;
    only once colours run low does it start reusing them.
    """
    identities = state.get("identities") or {}
    live = {w.get("workspace_id") for w in workspaces}

    adjacent = _neighbour_colours(workspaces, identities, workspace_id)
    in_use = [(i.get("colour") or "").lower()
              for wid, i in identities.items()
              if wid != workspace_id and wid in live and i.get("colour")]

    best = None
    for name, hexv in PALETTE:
        if not in_use and not adjacent:
            score = 1e9 - PALETTE.index((name, hexv))   # stable first pick
        else:
            d_all = min([distance(hexv, c) for c in in_use] or [1e6])
            d_adj = min([distance(hexv, c) for c in adjacent] or [1e6])
            score = min(d_all, d_adj * 0.5) if adjacent else d_all
        if best is None or score > best[0]:
            best = (score, hexv)

    state["alloc_cursor"] = (int(state.get("alloc_cursor") or 0) + 1) % len(PALETTE)
    return {"colour": best[1], "origin": "auto"}


def close_pairs(state, workspaces):
    """Live Space pairs whose colours may be hard to tell apart."""
    identities = state.get("identities") or {}
    live = [w.get("workspace_id") for w in _ordered(workspaces)]
    out = []
    for i, a in enumerate(live):
        for b in live[i + 1:]:
            ca = (identities.get(a) or {}).get("colour")
            cb = (identities.get(b) or {}).get("colour")
            if not ca or not cb:
                continue
            d = distance(ca, cb)
            if d < CLOSE_ENOUGH:
                out.append((a, b, d))
    return sorted(out, key=lambda x: x[2])


def ensure_all(state, workspaces):
    """Give every known workspace an identity. Returns the list of new IDs."""
    added = []
    for w in _ordered(workspaces):
        wid = w.get("workspace_id")
        if not wid:
            continue
        existing = (state.get("identities") or {}).get(wid)
        if existing and existing.get("colour"):
            continue
        if existing:
            # migrate a legacy emoji-era entry that somehow lost its colour
            existing.update(allocate(state, wid, workspaces))
            continue
        state.setdefault("identities", {})[wid] = allocate(state, wid, workspaces)
        added.append(wid)
    return added
