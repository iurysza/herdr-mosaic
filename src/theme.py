"""Derive a subtle per-space theme from one identity colour.

The space colour is used as an *accent*; surfaces are the theme's dark base
blended only a few percent toward it. The goal is "I'm in the purple
environment", not "the terminal has been painted purple".

Herdr 0.8.0 exposes no theme-introspection API -- there is no call that returns
the active theme's computed colours -- so the dark base is looked up from
`theme.name` in config.toml, and is overridable via the plugin's settings.json.
"""

import ctx

# Only these slots are ever written. Herdr's semantic status colours
# (red/green/yellow/peach) and text/subtext0 are deliberately excluded so an
# agent's state stays readable exactly as the user's base theme defines it.
TINT_KEYS = (
    "theme.custom.accent",
    "theme.custom.panel_bg",
    "theme.custom.surface_dim",
    "theme.custom.surface0",
    "theme.custom.surface1",
    "ui.accent",
)

OVERLAY_KEYS = ("theme.custom.overlay0", "theme.custom.overlay1")

# Never written by this plugin, for any reason.
PROTECTED_KEYS = (
    "theme.custom.red", "theme.custom.green", "theme.custom.yellow",
    "theme.custom.peach", "theme.custom.blue", "theme.custom.teal",
    "theme.custom.mauve", "theme.custom.text", "theme.custom.subtext0",
)

# Background colour of each built-in Herdr theme, used as the blend base.
BASE_BY_THEME = {
    "catppuccin": "#1e1e2e",
    "terminal": "#121212",
    "tokyo-night": "#1a1b26",
    "dracula": "#282a36",
    "nord": "#2e3440",
    "gruvbox": "#282828",
    "one-dark": "#282c34",
    "solarized": "#002b36",
    "kanagawa": "#1f1f28",
    "rose-pine": "#191724",
    "vesper": "#101010",
}

FALLBACK_BASE = "#1e1f22"

# How far each surface is blended toward the Space colour. `subtle` is a whisper;
# `bold` is unmistakable while still reading as a dark professional UI. Surfaces
# are what make a Space's colour visible when no pane is split -- the accent alone
# only shows on borders, highlights and navigation.
INTENSITY = {
    "subtle": {"panel_bg": 0.08, "surface_dim": 0.11,
               "surface0": 0.14, "surface1": 0.20},
    "medium": {"panel_bg": 0.14, "surface_dim": 0.19,
               "surface0": 0.25, "surface1": 0.36},
    "bold":   {"panel_bg": 0.22, "surface_dim": 0.29,
               "surface0": 0.38, "surface1": 0.52},
}

# Tinting borders/separators adds a lot of presence, so it rides with intensity.
INTENSITY_OVERLAYS = {"subtle": False, "medium": True, "bold": True}

DEFAULT_INTENSITY = "medium"


def intensity_name(cfg_settings=None):
    st = cfg_settings if cfg_settings is not None else ctx.settings()
    name = str(st.get("intensity") or DEFAULT_INTENSITY).strip().lower()
    return name if name in INTENSITY else DEFAULT_INTENSITY


def resolve_blend(cfg_settings=None):
    """Intensity preset with any explicit per-token overrides applied."""
    st = cfg_settings if cfg_settings is not None else ctx.settings()
    mix = dict(INTENSITY[intensity_name(st)])
    for key, val in (st.get("blend") or {}).items():
        try:
            mix[key] = max(0.0, min(0.75, float(val)))
        except (TypeError, ValueError):
            ctx.warn("ignoring non-numeric blend.%s" % key)
    return mix


def resolve_overlays(cfg_settings=None):
    st = cfg_settings if cfg_settings is not None else ctx.settings()
    explicit = st.get("tint_overlays")
    if explicit is None:
        return INTENSITY_OVERLAYS[intensity_name(st)]
    return bool(explicit)

LIGHT_THEMES = ("catppuccin-latte", "tokyo-night-day", "rose-pine-dawn",
                "solarized-light", "gruvbox-light", "one-light")


def parse_hex(value):
    v = (value or "").strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6:
        raise ValueError("not a hex colour: %r" % (value,))
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def to_hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(c)))) for c in rgb)


# Relative luminance ceiling per surface, so a very light identity colour cannot
# wash the chrome out. Pastels sit at luminance 157-214 -- roughly 40 higher than
# the saturated palette -- so at `bold` an uncapped blend would lift `surface1`
# into light-theme territory. Luminance is linear in the blend amount, so the
# maximum safe amount is solved exactly rather than clamped by trial.
LUMA_CEILING = {
    "panel_bg": 62.0,
    "surface_dim": 72.0,
    "surface0": 84.0,
    "surface1": 102.0,
}


def luminance(hexv):
    r, g, b = parse_hex(hexv)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def blend_capped(base, target, amount, ceiling):
    """Blend, but never past `ceiling` relative luminance."""
    lb, lt = luminance(base), luminance(target)
    if lt > lb and ceiling is not None:
        if lb >= ceiling:
            return base
        max_amount = (ceiling - lb) / (lt - lb)
        amount = min(amount, max_amount)
    return blend(base, target, max(0.0, amount))


def blend(base, target, amount):
    """Linear sRGB interpolation: 0.0 -> base, 1.0 -> target."""
    amount = max(0.0, min(1.0, float(amount)))
    b = parse_hex(base)
    t = parse_hex(target)
    return to_hex(tuple(b[i] + (t[i] - b[i]) * amount for i in range(3)))


def lighten(colour, amount):
    return blend(colour, "#ffffff", amount)


def is_light_theme(theme_name):
    return (theme_name or "").strip().lower() in LIGHT_THEMES


def resolve_base(theme_name, cfg_settings=None):
    """Pick the dark base to blend from."""
    st = cfg_settings if cfg_settings is not None else ctx.settings()
    configured = (st.get("theme_base") or "auto").strip()
    if configured.lower() != "auto":
        try:
            parse_hex(configured)
            return configured.lower()
        except ValueError:
            ctx.warn("settings.theme_base %r is not a hex colour; using auto"
                     % configured)
    name = (theme_name or "").strip().lower()
    if name in BASE_BY_THEME:
        return BASE_BY_THEME[name]
    # `catppuccin-mocha` etc. -> match on the family prefix
    for family, base in BASE_BY_THEME.items():
        if name.startswith(family):
            return base
    return FALLBACK_BASE


def generate(colour, theme_name, cfg_settings=None):
    """Return {dotted_config_key: value} for one space colour."""
    st = cfg_settings if cfg_settings is not None else ctx.settings()
    base = resolve_base(theme_name, st)
    mix = resolve_blend(st)

    values = {
        "theme.custom.accent": colour,
        "ui.accent": colour,
        "theme.custom.panel_bg": blend_capped(base, colour, mix["panel_bg"],
                                             LUMA_CEILING["panel_bg"]),
        "theme.custom.surface_dim": blend_capped(base, colour, mix["surface_dim"],
                                                LUMA_CEILING["surface_dim"]),
        "theme.custom.surface0": blend_capped(base, colour, mix["surface0"],
                                              LUMA_CEILING["surface0"]),
        "theme.custom.surface1": blend_capped(base, colour, mix["surface1"],
                                              LUMA_CEILING["surface1"]),
    }
    if resolve_overlays(st):
        strength = mix["surface1"]
        values["theme.custom.overlay0"] = blend(lighten(base, 0.28), colour,
                                                min(0.6, strength * 1.1))
        values["theme.custom.overlay1"] = blend(lighten(base, 0.38), colour,
                                                min(0.7, strength * 1.3))
    return values


def managed_keys(cfg_settings=None):
    st = cfg_settings if cfg_settings is not None else ctx.settings()
    keys = list(TINT_KEYS)
    if resolve_overlays(st):
        keys.extend(OVERLAY_KEYS)
    return keys


def swatch(hexv, width=6):
    """A truecolor ANSI block, for previewing a colour in the terminal."""
    r, g, b = parse_hex(hexv)
    return "\x1b[48;2;%d;%d;%dm%s\x1b[0m" % (r, g, b, " " * width)
