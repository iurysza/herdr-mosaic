"""Interactive stale-agent pruner popup.

The popup is deliberately a review surface, not an automatic cleanup job. It
shows only settled agents, accepts selections only when they are older than the
user's configured threshold, and revalidates those selections before closing.
"""

import curses
import os
import sys

import agent_triage
import ctx
import rpc
import state as state_mod

PROTECTED_PANE_ENV = "MOSAIC_PRUNE_PROTECTED_PANE"
SETTING = "prune_stale_after"


def _format_age(seconds):
    if seconds is None:
        return "—"
    if seconds < 60:
        return "now"
    if seconds < 60 * 60:
        return "%dm" % (seconds // 60)
    if seconds < 24 * 60 * 60:
        return "%dh" % (seconds // (60 * 60))
    return "%dd" % (seconds // (24 * 60 * 60))


def _catalog():
    workspaces = {w.get("workspace_id"): w.get("label") or w.get("workspace_id")
                  for w in rpc.workspaces()}
    tabs = {}
    for workspace_id in workspaces:
        for tab in rpc.call("tab.list", {"workspace_id": workspace_id}).get("tabs", []):
            tabs[tab.get("tab_id")] = tab.get("label") or tab.get("tab_id")
    return workspaces, tabs


class Pruner(object):
    def __init__(self, protected_pane_id=None):
        self.protected_pane_id = protected_pane_id
        self.rows = []
        self.workspaces = {}
        self.tabs = {}
        self.cursor = 0
        self.selected = set()
        self.confirming = False
        self.notice = ""
        self.reload()

    def threshold(self):
        return agent_triage.parse_duration(ctx.settings().get(SETTING))

    def threshold_text(self):
        raw = ctx.settings().get(SETTING)
        return raw if self.threshold() is not None else "unset"

    def reload(self):
        self.workspaces, self.tabs = _catalog()
        self.rows = agent_triage.prune_rows(
            rpc.agents(), state_mod.load(), self.threshold(), self.protected_pane_id)
        live = {row["pane_id"] for row in self.rows if row["eligible"]}
        self.selected.intersection_update(live)
        self.cursor = max(0, min(self.cursor, max(0, len(self.rows) - 1)))

    def _line(self, row, width):
        agent = row["agent"]
        marker = "[x]" if row["pane_id"] in self.selected else "[ ]"
        if not row["eligible"]:
            marker = " - "
        age = _format_age(row["age"])
        state = agent.get("agent_status") or "unknown"
        place = self.workspaces.get(agent.get("workspace_id"), agent.get("workspace_id") or "?")
        tab = self.tabs.get(agent.get("tab_id"), agent.get("terminal_title_stripped") or "?")
        text = "%s %9s %-7s %-9s %s › %s" % (
            marker, age, state, agent.get("agent") or "agent", place, tab)
        return text[:max(0, width - 2)]

    @staticmethod
    def _column_headings(width):
        text = "%3s %9s %-7s %-9s %s" % ("SEL", "AGE", "STATE", "AGENT", "SESSION")
        return text[:max(0, width - 2)]

    def draw(self, screen):
        screen.erase()
        height, width = screen.getmaxyx()
        screen.addnstr(0, 1, "Prune stale agent sessions", max(0, width - 2), curses.A_BOLD)
        detail = "Stale after: %s  ·  idle/done only" % self.threshold_text()
        screen.addnstr(1, 1, detail, max(0, width - 2), curses.A_DIM)
        screen.addnstr(2, 1, "─" * max(0, width - 2), max(0, width - 2))
        screen.addnstr(3, 1, self._column_headings(width), max(0, width - 2), curses.A_DIM)
        if self.confirming:
            self._draw_confirmation(screen, height, width)
        elif not self.rows:
            screen.addnstr(4, 2, "No idle or done agents to review.", max(0, width - 4))
        else:
            top = 4
            available = max(1, height - top - 2)
            offset = max(0, min(self.cursor - available + 1,
                                max(0, len(self.rows) - available)))
            for index in range(available):
                row_index = index + offset
                if row_index >= len(self.rows):
                    break
                attr = curses.A_REVERSE if row_index == self.cursor else 0
                screen.addnstr(top + index, 1, self._line(self.rows[row_index], width),
                               max(0, width - 2), attr)
        if self.notice:
            screen.addnstr(height - 2, 1, self.notice, max(0, width - 2), curses.A_BOLD)
        help_text = "↑↓/jk move  Space toggle  t threshold  x terminate  r reload  q cancel"
        if self.confirming:
            help_text = "x confirm close  Esc cancel"
        screen.addnstr(height - 1, 1, help_text[:max(0, width - 2)],
                       max(0, width - 2), curses.A_DIM)
        screen.refresh()

    def _draw_confirmation(self, screen, height, width):
        selected = [row for row in self.rows if row["pane_id"] in self.selected]
        screen.addnstr(4, 2, "Close %d selected agent pane(s)?" % len(selected),
                       max(0, width - 4), curses.A_BOLD)
        screen.addnstr(6, 2, "This stops each agent process. Pi session history stays on disk.",
                       max(0, width - 4))
        for index, row in enumerate(selected[:max(0, height - 10)]):
            screen.addnstr(8 + index, 3, self._line(row, width), max(0, width - 5))

    def prompt_threshold(self, screen):
        height, width = screen.getmaxyx()
        label = "Stale after (for example 8h or 2d; blank cancels): "
        screen.addnstr(height - 2, 1, " " * max(0, width - 2), max(0, width - 2))
        screen.addnstr(height - 2, 1, label, max(0, width - 2))
        curses.echo()
        curses.curs_set(1)
        try:
            raw = screen.getstr(height - 2, min(width - 2, len(label) + 1), 16)
            value = raw.decode("utf-8", "replace").strip().lower()
        except Exception:
            value = ""
        curses.noecho()
        curses.curs_set(0)
        if not value:
            self.notice = "Threshold unchanged."
        elif agent_triage.parse_duration(value) is None:
            self.notice = "Use a positive whole duration, for example 8h or 2d."
        else:
            ctx.save_settings({SETTING: value})
            self.notice = "Stale threshold set to %s." % value
            self.reload()

    def confirm(self):
        closed, skipped, failures = agent_triage.close_selected(
            [row["pane_id"] for row in self.rows if row["pane_id"] in self.selected],
            self.threshold(), self.protected_pane_id)
        parts = []
        if closed:
            parts.append("closed %d" % len(closed))
        if skipped:
            parts.append("skipped %d changed" % len(skipped))
        if failures:
            parts.append("failed %d" % len(failures))
        self.notice = "; ".join(parts) or "Nothing closed."
        self.confirming = False
        self.selected.clear()
        self.reload()

    def loop(self, screen):
        curses.curs_set(0)
        screen.keypad(True)
        while True:
            self.draw(screen)
            try:
                key = screen.getch()
            except KeyboardInterrupt:
                return
            if self.confirming:
                if key in (27, ord("q")):
                    self.confirming = False
                    self.notice = "Termination cancelled."
                elif key == ord("x"):
                    self.confirm()
                continue
            if key in (ord("q"), 27):
                return
            if key in (curses.KEY_UP, ord("k")):
                self.cursor = max(0, self.cursor - 1)
            elif key in (curses.KEY_DOWN, ord("j")):
                self.cursor = min(max(0, len(self.rows) - 1), self.cursor + 1)
            elif key == ord("r"):
                self.reload()
                self.notice = "Reloaded live agent state."
            elif key == ord("t"):
                self.prompt_threshold(screen)
            elif key == ord(" ") and self.rows:
                row = self.rows[self.cursor]
                if row["eligible"]:
                    if row["pane_id"] in self.selected:
                        self.selected.remove(row["pane_id"])
                    else:
                        self.selected.add(row["pane_id"])
                else:
                    self.notice = "Only stale, observed, non-current agents can be selected."
            elif key == ord("x"):
                if self.selected:
                    self.confirming = True
                    self.notice = ""
                else:
                    self.notice = "Select one or more stale agents first."


def run(argv):
    if argv:
        sys.stderr.write("usage: prune\n")
        return 1
    protected = os.environ.get(PROTECTED_PANE_ENV) or None
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        sys.stderr.write("prune needs a terminal; run it through the Mosaic action.\n")
        return 1
    try:
        curses.wrapper(Pruner(protected).loop)
    except curses.error as exc:
        sys.stderr.write("prune could not start (%s)\n" % exc)
        return 1
    return 0
