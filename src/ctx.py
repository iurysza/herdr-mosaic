"""Environment resolution, logging and cross-process locking.

Herdr runs every plugin command as a fresh short-lived process, and several
hooks can fire concurrently (a `workspace.focused` and a `pane.moved` may
overlap). Every mutation therefore runs under one exclusive file lock so state
and config writes are serialised.
"""

import errno
import fcntl
import json
import os
import sys
import time

PLUGIN_ID = "iurysza.mosaic"
PLUGIN_VERSION = "0.2.0"  # x-release-please-version
PLUGIN_NAME = "Mosaic"

# Herdr runs plugin commands with a minimal PATH; never rely on PATH lookups.
HOME = os.path.expanduser("~")


def _env(name, default=None):
    v = os.environ.get(name)
    return v if v else default


def state_dir():
    d = _env("HERDR_PLUGIN_STATE_DIR",
             os.path.join(HOME, ".local", "state", "herdr", "plugins", PLUGIN_ID))
    os.makedirs(d, exist_ok=True)
    return d


def config_dir():
    d = _env("HERDR_PLUGIN_CONFIG_DIR",
             os.path.join(HOME, ".config", "herdr", "plugins", "config", PLUGIN_ID))
    os.makedirs(d, exist_ok=True)
    return d


def plugin_root():
    return _env("HERDR_PLUGIN_ROOT",
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def herdr_config_path():
    return _env("HERDR_CONFIG_PATH", os.path.join(HOME, ".config", "herdr", "config.toml"))


def socket_path():
    return _env("HERDR_SOCKET_PATH", os.path.join(HOME, ".config", "herdr", "herdr.sock"))


def herdr_bin():
    return _env("HERDR_BIN_PATH", os.path.join(HOME, ".local", "bin", "herdr"))


def event_name():
    return _env("HERDR_PLUGIN_EVENT")


def event_payload():
    raw = _env("HERDR_PLUGIN_EVENT_JSON")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        return {}


def invocation_context():
    raw = _env("HERDR_PLUGIN_CONTEXT_JSON")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        return {}


# --------------------------------------------------------------------------
# settings (user-tunable, lives in the plugin config dir)
# --------------------------------------------------------------------------

DEFAULT_SETTINGS = {
    # Glyph drawn in the Space's colour in the sidebar. Change it if it reads too
    # close to Herdr's state icon: "\u25cf" dot, "\u25c6" diamond, "\u258a" bar.
    "marker": "\u25a0",
    # How strongly the Space colour shows in Herdr's chrome:
    # "subtle" | "medium" | "bold" (see theme.INTENSITY).
    "intensity": "medium",
    # Dark base that space colours are blended into. `auto` derives it from
    # `theme.name` in config.toml (see theme.BASE_BY_THEME).
    "theme_base": "auto",
    # Per-token overrides on top of the intensity preset. Empty = use the preset.
    "blend": {},
    # Tint overlay0/overlay1 (borders, separators). null = follow the intensity
    # preset; true/false to force. These slots may carry dim text in some themes.
    "tint_overlays": None,
    # Show an in-app toast naming the Space on every genuine Space change.
    # Requires `ui.toast.delivery` to be "herdr" (or another delivery) in
    # config.toml -- the plugin will not change that setting for you.
    "announce": False,
    # Set the outer terminal window title on workspace focus.
    "window_title": True,
    "window_title_suffix": " — Herdr",
}


def settings():
    path = os.path.join(config_dir(), "settings.json")
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                user = json.load(fh)
            for k, v in (user or {}).items():
                if isinstance(v, dict) and isinstance(out.get(k), dict):
                    out[k].update(v)
                else:
                    out[k] = v
        except (ValueError, OSError) as exc:
            log("warn: unreadable settings.json (%s); using defaults" % exc)
    return out


def save_settings(updates):
    """Merge `updates` into settings.json atomically. Returns the merged dict."""
    path = settings_path()
    current = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                current = json.load(fh) or {}
        except (ValueError, OSError):
            current = {}
    for k, v in updates.items():
        if isinstance(v, dict) and isinstance(current.get(k), dict):
            current[k].update(v)
        else:
            current[k] = v
    atomic_write(path, json.dumps(current, indent=2, ensure_ascii=False,
                                  sort_keys=True) + "\n")
    return current


def settings_path():
    return os.path.join(config_dir(), "settings.json")


# --------------------------------------------------------------------------
# logging
# --------------------------------------------------------------------------

_LOG_LIMIT = 256 * 1024


def log(msg):
    """Log to stdout (captured by `herdr plugin log list`) and to a local file."""
    line = "%s %s" % (time.strftime("%Y-%m-%dT%H:%M:%S"), msg)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()
    try:
        path = os.path.join(state_dir(), "plugin.log")
        if os.path.exists(path) and os.path.getsize(path) > _LOG_LIMIT:
            os.replace(path, path + ".1")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def warn(msg):
    line = "%s WARN %s" % (time.strftime("%Y-%m-%dT%H:%M:%S"), msg)
    sys.stderr.write(line + "\n")
    sys.stderr.flush()
    try:
        with open(os.path.join(state_dir(), "plugin.log"), "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


# --------------------------------------------------------------------------
# locking
# --------------------------------------------------------------------------

class Lock(object):
    """Exclusive advisory lock shared by every plugin process."""

    def __init__(self, name="plugin.lock", timeout=10.0):
        self.path = os.path.join(state_dir(), name)
        self.timeout = timeout
        self._fh = None

    def __enter__(self):
        self._fh = open(self.path, "a+")
        deadline = time.time() + self.timeout
        while True:
            try:
                fcntl.flock(self._fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except IOError as exc:
                if exc.errno not in (errno.EAGAIN, errno.EACCES):
                    raise
                if time.time() >= deadline:
                    self._fh.close()
                    self._fh = None
                    raise RuntimeError("timed out waiting for plugin lock")
                time.sleep(0.02)

    def __exit__(self, *exc):
        if self._fh is not None:
            fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
            self._fh.close()
            self._fh = None
        return False


def atomic_write(path, text):
    """Write via temp file + rename so readers never observe a partial file."""
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, ".%s.tmp.%d" % (os.path.basename(path), os.getpid()))
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
