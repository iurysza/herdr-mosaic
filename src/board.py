"""Workspace Agent Board (optional) -- collapsible per-space agent groups.

Herdr's built-in Agents sidebar has no plugin API for injecting real group
headers or collapse controls, so this optional pane provides them. It is a
read-only projection over `agent.list` plus `workspace.list`: it never invents
agent state, never changes detection, and the only mutation it performs is
focusing an agent the user selects.
"""

import curses
import sys

import ctx
import rpc
import state as state_mod

STATUS_ORDER = {"blocked": 0, "working": 1, "unknown": 2, "idle": 3, "done": 4}


def _collect():
    st = state_mod.load()
    workspaces = rpc.workspaces()
    agents = rpc.agents()
    by_ws = {}
    for a in agents:
        by_ws.setdefault(a.get("workspace_id"), []).append(a)
    groups = []
    for w in sorted(workspaces, key=lambda x: (x.get("number") or 0,
                                               x.get("workspace_id") or "")):
        wid = w.get("workspace_id")
        members = by_ws.get(wid) or []
        if not members:
            continue
        info = state_mod.identity_of(st, wid) or {}
        members.sort(key=lambda a: (STATUS_ORDER.get(a.get("agent_status"), 9),
                                    a.get("pane_id") or ""))
        groups.append({
            "workspace_id": wid,
            "label": w.get("label") or wid,
            "emoji": info.get("emoji") or "•",
            "agents": members,
        })
    return groups


def _summary(group):
    counts = {}
    for a in group["agents"]:
        s = a.get("agent_status") or "unknown"
        counts[s] = counts.get(s, 0) + 1
    parts = []
    for key in ("working", "blocked", "idle", "done", "unknown"):
        if counts.get(key):
            parts.append("%d %s" % (counts[key], key))
    return " · ".join(parts)


class Board(object):
    def __init__(self):
        self.groups = _collect()
        self.collapsed = set()
        self.cursor = 0

    def rows(self):
        """Flatten to (kind, group, agent) display rows."""
        out = []
        for g in self.groups:
            out.append(("group", g, None))
            if g["workspace_id"] not in self.collapsed:
                for a in g["agents"]:
                    out.append(("agent", g, a))
        return out

    def draw(self, scr):
        scr.erase()
        h, w = scr.getmaxyx()
        scr.addnstr(0, 1, "Workspace Agent Board", max(0, w - 2), curses.A_BOLD)
        scr.addnstr(1, 1, "─" * max(0, w - 2), max(0, w - 2))
        rows = self.rows()
        if not rows:
            scr.addnstr(3, 2, "No agents detected.", max(0, w - 4))
        top = 2
        avail = max(1, h - top - 1)
        self.cursor = max(0, min(self.cursor, max(0, len(rows) - 1)))
        off = max(0, min(self.cursor - avail + 1, max(0, len(rows) - avail)))
        for i in range(avail):
            ri = i + off
            if ri >= len(rows):
                break
            kind, g, a = rows[ri]
            sel = (ri == self.cursor)
            attr = curses.A_REVERSE if sel else 0
            if kind == "group":
                arrow = "▶" if g["workspace_id"] in self.collapsed else "▼"
                text = "%s %s %s" % (arrow, g["emoji"], g["label"])
                pad = max(1, w - len(text) - len(_summary(g)) - 4)
                line = "%s%s%s" % (text, " " * pad, _summary(g))
                scr.addnstr(top + i, 1, line, max(0, w - 2), attr | curses.A_BOLD)
            else:
                status = a.get("agent_status") or "unknown"
                name = a.get("agent") or "agent"
                title = a.get("terminal_title_stripped") or ""
                left = "    %s %-10s %s" % (g["emoji"], name, status)
                right = title[:max(0, w - len(left) - 4)]
                scr.addnstr(top + i, 1, "%s  %s" % (left, right),
                            max(0, w - 2), attr)
        scr.addnstr(h - 1, 1,
                    "↑↓ move  Space/Enter collapse-or-focus  r reload  q quit"[:w - 2],
                    max(0, w - 2), curses.A_DIM)
        scr.refresh()

    def loop(self, scr):
        curses.curs_set(0)
        scr.keypad(True)
        while True:
            self.draw(scr)
            ch = scr.getch()
            rows = self.rows()
            if ch in (ord('q'), 27):
                return
            if ch == ord('r'):
                self.groups = _collect()
                continue
            if ch in (curses.KEY_UP, ord('k')):
                self.cursor = max(0, self.cursor - 1)
                continue
            if ch in (curses.KEY_DOWN, ord('j')):
                self.cursor = min(max(0, len(rows) - 1), self.cursor + 1)
                continue
            if ch in (curses.KEY_ENTER, 10, 13, ord(' ')):
                if not rows:
                    continue
                kind, g, a = rows[self.cursor]
                if kind == "group":
                    wid = g["workspace_id"]
                    if wid in self.collapsed:
                        self.collapsed.discard(wid)
                    else:
                        self.collapsed.add(wid)
                else:
                    _, err = rpc.try_call("agent.focus", {"pane_id": a["pane_id"]})
                    if err:
                        rpc.try_call("agent.focus", {"agent": a.get("pane_id")})
                continue


def run(argv):
    if "--once" in argv:
        for g in _collect():
            sys.stdout.write("%s %s  (%s)\n" % (g["emoji"], g["label"], _summary(g)))
            for a in g["agents"]:
                sys.stdout.write("    %-10s %s\n" % (a.get("agent"),
                                                     a.get("agent_status")))
        return 0
    try:
        curses.wrapper(Board().loop)
    except curses.error as exc:
        sys.stderr.write("board could not start (%s); try --once\n" % exc)
        return 1
    return 0
