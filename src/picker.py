"""Space colour picker -- a curses popup run as a plugin pane.

A Space's identity is one colour; the sidebar dot and the chrome tint both derive
from it. Herdr plugin actions cannot render native forms, so this is a small
terminal UI in a popup pane. It applies to the workspace it was invoked from
(passed as SPACE_IDENTITY_TARGET by `plugin.pane.open`), falling back to the
focused workspace when run standalone.
"""

import curses
import os
import sys

import ctx
import identity as ident
import rpc
import state as state_mod

CUSTOM = "custom hex..."


def _target():
    wid = os.environ.get("SPACE_IDENTITY_TARGET")
    if wid:
        return wid
    w = rpc.focused_workspace()
    return w["workspace_id"] if w else None


def _label(wid):
    for w in rpc.workspaces():
        if w.get("workspace_id") == wid:
            return w.get("label") or wid
    return wid


class Picker(object):
    """Single-column colour list; the marker is previewed in each row's colour."""

    def __init__(self, wid, label, current):
        self.wid = wid
        self.label = label
        self.marker = ctx.settings().get("marker") or ident.DEFAULT_MARKER
        self.rows = list(ident.PALETTE) + [(CUSTOM, None)]
        self.custom = None
        cur = (current or {}).get("colour")
        self.idx = 0
        for i, (_n, hexv) in enumerate(self.rows):
            if hexv and cur and hexv.lower() == cur.lower():
                self.idx = i
        if cur and not ident.is_exact_palette_colour(cur):
            self.custom = ident.normalise_hex(cur)
            self.idx = len(self.rows) - 1

    def colour(self):
        _name, hexv = self.rows[self.idx]
        return self.custom if hexv is None else hexv

    # -- colour pairs ---------------------------------------------------
    def _init_colours(self):
        self.pairs = {}
        if not curses.has_colors():
            return
        curses.start_color()
        try:
            curses.use_default_colors()
        except curses.error:
            pass
        # map each palette hex to the nearest of the 256 xterm colours
        for i, (_name, hexv) in enumerate(ident.PALETTE):
            idx = _xterm256(hexv)
            try:
                curses.init_pair(i + 1, idx, -1)
                self.pairs[hexv] = curses.color_pair(i + 1)
            except curses.error:
                pass

    def _attr_for(self, hexv):
        return self.pairs.get(hexv, 0)

    # -- drawing --------------------------------------------------------
    def draw(self, scr):
        scr.erase()
        h, w = scr.getmaxyx()
        scr.addnstr(0, 1, "Space Colour — %s  (%s)" % (self.label, self.wid),
                    max(0, w - 2), curses.A_BOLD)
        scr.addnstr(1, 1, "─" * max(0, w - 2), max(0, w - 2))
        top = 2
        avail = max(1, h - top - 3)
        off = max(0, min(self.idx - avail + 1, max(0, len(self.rows) - avail)))
        for i in range(avail):
            ri = i + off
            if ri >= len(self.rows):
                break
            name, hexv = self.rows[ri]
            sel = (ri == self.idx)
            mark = "> " if sel else "  "
            if hexv is None:
                text = "%s%s %s" % (mark, CUSTOM, self.custom or "")
                attr = curses.A_REVERSE if sel else 0
                scr.addnstr(top + i, 1, text, max(0, w - 2), attr)
            else:
                base = curses.A_REVERSE if sel else 0
                scr.addnstr(top + i, 1, mark, 3, base)
                scr.addnstr(top + i, 4, self.marker, 2,
                            self._attr_for(hexv) | curses.A_BOLD | base)
                scr.addnstr(top + i, 6, " %-8s %s" % (name, hexv),
                            max(0, w - 8), base)
        sel_col = self.colour()
        scr.addnstr(h - 2, 1, "Selected: ", max(0, w - 2), curses.A_BOLD)
        if sel_col:
            scr.addnstr(h - 2, 11, self.marker, 2,
                        self._attr_for(sel_col) | curses.A_BOLD)
            scr.addnstr(h - 2, 13, " " + sel_col, max(0, w - 14), curses.A_BOLD)
        scr.addnstr(h - 1, 1, "↑↓ move   Enter save   q cancel"[:w - 2],
                    max(0, w - 2), curses.A_DIM)
        scr.refresh()

    def prompt(self, scr, label):
        h, w = scr.getmaxyx()
        curses.echo()
        curses.curs_set(1)
        scr.addnstr(h - 2, 1, " " * (w - 2), max(0, w - 2))
        scr.addnstr(h - 2, 1, label, max(0, w - 2))
        scr.refresh()
        try:
            raw = scr.getstr(h - 2, min(w - 2, 1 + len(label)), 16)
            text = raw.decode("utf-8", "replace").strip()
        except Exception:
            text = ""
        curses.noecho()
        curses.curs_set(0)
        return text

    def loop(self, scr):
        curses.curs_set(0)
        scr.keypad(True)
        self._init_colours()
        while True:
            self.draw(scr)
            try:
                ch = scr.getch()
            except KeyboardInterrupt:
                return False
            if ch in (ord('q'), 27):
                return False
            if ch in (curses.KEY_UP, ord('k')):
                self.idx = (self.idx - 1) % len(self.rows)
                continue
            if ch in (curses.KEY_DOWN, ord('j')):
                self.idx = (self.idx + 1) % len(self.rows)
                continue
            if ch in (curses.KEY_ENTER, 10, 13):
                if self.rows[self.idx][1] is None:
                    raw = self.prompt(scr, "Hex colour (#rrggbb): ")
                    resolved = ident.resolve_colour(raw)
                    if resolved:
                        self.custom = resolved
                        return True
                    continue
                return True


def _xterm256(hexv):
    """Nearest xterm-256 index for a hex colour (16..231 cube + greys)."""
    v = hexv.lstrip("#")
    r, g, b = int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
    levels = [0, 95, 135, 175, 215, 255]

    def nearest(c):
        return min(range(6), key=lambda i: abs(levels[i] - c))

    ri, gi, bi = nearest(r), nearest(g), nearest(b)
    cube = 16 + 36 * ri + 6 * gi + bi
    cube_err = ((levels[ri] - r) ** 2 + (levels[gi] - g) ** 2
                + (levels[bi] - b) ** 2)
    grey_val = (r + g + b) // 3
    gi2 = min(range(24), key=lambda i: abs((8 + 10 * i) - grey_val))
    grey = 232 + gi2
    gv = 8 + 10 * gi2
    grey_err = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2
    return cube if cube_err <= grey_err else grey


def run(argv):
    wid = _target()
    if not wid:
        sys.stderr.write("no workspace to edit\n")
        return 1
    label = _label(wid)
    st = state_mod.load()
    current = state_mod.identity_of(st, wid)

    picker = Picker(wid, label, current)
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        sys.stderr.write(
            "picker needs a terminal; run it as the plugin popup, or use:\n"
            "  main.py apply-identity --workspace %s --colour blue\n" % wid)
        return 1
    try:
        ok = curses.wrapper(picker.loop)
    except curses.error as exc:
        sys.stderr.write("picker could not start (%s). Use:\n"
                         "  main.py apply-identity --workspace %s --colour blue\n"
                         % (exc, wid))
        return 1
    if not ok:
        sys.stdout.write("cancelled\n")
        return 0

    import main as main_mod
    rc = main_mod.cmd_apply_identity(["--workspace", wid,
                                      "--colour", picker.colour()])
    try:
        rpc.try_call("popup.close", {})
    except Exception:
        pass
    return rc
