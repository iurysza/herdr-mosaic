"""Pick-and-place pane moves with a confirmation popup.

The source pane ID is durable plugin state so a user can navigate normally between
selection and placement. Every function that changes it or calls ``pane.move``
expects the caller to hold ``ctx.Lock``.
"""

import curses
import os
import sys

import ctx
import rpc
import state as state_mod


PENDING_KEY = "pending_pane_move"
SOURCE_ENV = "MOSAIC_PANE_MOVE_SOURCE"
DESTINATION_ENV = "MOSAIC_PANE_MOVE_DESTINATION"


class PaneMoveError(RuntimeError):
    pass


def focused_pane_id():
    """Return the pane represented by an action invocation, if available."""
    pane_id = os.environ.get("HERDR_PANE_ID")
    if pane_id:
        return pane_id
    context = ctx.invocation_context()
    return context.get("focused_pane_id") or context.get("pane_id")


def _panes_by_id():
    return dict((pane.get("pane_id"), pane) for pane in rpc.panes()
                if pane.get("pane_id"))


def pending_source(st):
    record = st.get(PENDING_KEY)
    if not isinstance(record, dict):
        return None
    pane_id = record.get("pane_id")
    return pane_id if isinstance(pane_id, str) and pane_id else None


def _set_pending(st, pane_id):
    st[PENDING_KEY] = {"pane_id": pane_id}


def clear_pending(st, source_id=None):
    """Clear the selection, optionally only when it still names ``source_id``."""
    current = pending_source(st)
    if source_id is not None and current != source_id:
        return False
    if PENDING_KEY not in st:
        return False
    st.pop(PENDING_KEY, None)
    return True


def _notice(body):
    """Best-effort transient feedback; action logs stay quiet."""
    rpc.try_call("notification.show", {
        "title": "Mosaic",
        "body": body,
        "sound": "none",
    })


def _move_result(pane_id, destination):
    result = rpc.call("pane.move", {
        "pane_id": pane_id,
        "destination": destination,
        "focus": True,
    })
    outcome = (result or {}).get("move_result") or {}
    if not outcome.get("changed"):
        raise PaneMoveError("pane.move: %s" %
                            (outcome.get("reason") or "move rejected"))
    return outcome


def _new_tab_destination(destination):
    workspace_id = destination.get("workspace_id")
    if not workspace_id:
        raise PaneMoveError("destination pane has no workspace")
    return {"type": "new_tab", "workspace_id": workspace_id}


def _right_split_destination(destination):
    tab_id = destination.get("tab_id")
    pane_id = destination.get("pane_id")
    if not tab_id or not pane_id:
        raise PaneMoveError("destination pane has no tab")
    return {
        "type": "tab",
        "tab_id": tab_id,
        "target_pane_id": pane_id,
        "split": "right",
        "ratio": 0.5,
    }


def capture_or_open():
    """Capture the focused pane, or open placement confirmation.

    Caller holds ``ctx.Lock``. A missing saved source is cleared immediately;
    there is deliberately no timeout for a valid source.
    """
    st = state_mod.load()
    destination_id = focused_pane_id()
    panes = _panes_by_id()
    source_id = pending_source(st)

    if source_id:
        if source_id not in panes:
            clear_pending(st, source_id)
            state_mod.save(st)
            _notice("The selected pane is no longer available.")
            return 0
        if destination_id not in panes:
            _notice("Focus a destination pane, then press prefix+/ again.")
            return 1
        _result, error = rpc.try_call("plugin.pane.open", {
            "plugin_id": ctx.PLUGIN_ID,
            "entrypoint": "pane-move",
            "focus": True,
            "placement": "popup",
            "env": {
                SOURCE_ENV: source_id,
                DESTINATION_ENV: destination_id,
            },
        })
        if error:
            ctx.warn("could not open pane move confirmation: %s" % error)
            return 1
        return 0

    if destination_id not in panes:
        ctx.warn("pane move requires a focused pane")
        return 1
    _set_pending(st, destination_id)
    state_mod.save(st)
    _notice("Pane selected. Navigate, then press prefix+/ again.")
    return 0


def promote_focused():
    """Move the focused pane to a new tab in its current workspace.

    Caller holds ``ctx.Lock``. This is intentionally independent from a pending
    pick-and-place move, so the fast shortcut cannot discard a selection.
    """
    pane_id = focused_pane_id()
    pane = _panes_by_id().get(pane_id)
    if not pane:
        raise PaneMoveError("promote requires a focused pane")
    _move_result(pane_id, _new_tab_destination(pane))
    return 0


def move(source_id, destination_id, placement):
    """Perform one confirmed placement and clear a successful selection.

    ``placement`` is ``split`` or ``tab``. Caller holds ``ctx.Lock``.
    Returns a stable outcome string for the popup rather than raising for
    expected stale and same-pane cases.
    """
    if placement not in ("split", "tab"):
        raise PaneMoveError("unknown placement %r" % placement)
    st = state_mod.load()
    panes = _panes_by_id()
    source = panes.get(source_id)
    if not source:
        clear_pending(st, source_id)
        state_mod.save(st)
        return "source_missing"
    destination = panes.get(destination_id)
    if not destination:
        return "destination_missing"
    if placement == "split" and source_id == destination_id:
        return "same_pane"

    target = (_right_split_destination(destination)
              if placement == "split" else _new_tab_destination(destination))
    _move_result(source_id, target)
    clear_pending(st, source_id)
    state_mod.save(st)
    return "moved"


def cancel(source_id):
    """Cancel an open confirmation without clearing a newer selection."""
    st = state_mod.load()
    if clear_pending(st, source_id):
        state_mod.save(st)


def _pane_details(pane_id, panes, workspace_names):
    pane = panes.get(pane_id)
    if not pane:
        return pane_id, "No longer available"
    title = (pane.get("terminal_title_stripped") or pane.get("terminal_title")
             or pane_id)
    workspace_id = pane.get("workspace_id") or "?"
    workspace = workspace_names.get(workspace_id, workspace_id)
    return title, "%s  ·  %s" % (workspace, pane_id)


def placement_for_key(key):
    """Return the explicit placement selected by one popup key, if any."""
    if key in (ord("s"), ord("S")):
        return "split"
    if key in (ord("t"), ord("T")):
        return "tab"
    return None


class PaneMovePopup(object):
    def __init__(self, source_id, destination_id):
        self.source_id = source_id
        self.destination_id = destination_id
        self.notice = ""
        self.panes = {}
        self.workspace_names = {}
        self.reload()

    def reload(self):
        self.panes = _panes_by_id()
        self.workspace_names = dict(
            (workspace.get("workspace_id"),
             workspace.get("label") or workspace.get("workspace_id"))
            for workspace in rpc.workspaces() if workspace.get("workspace_id"))

    def draw(self, screen):
        screen.erase()
        height, width = screen.getmaxyx()
        limit = max(0, width - 4)
        source_title, source_place = _pane_details(
            self.source_id, self.panes, self.workspace_names)
        destination_title, destination_place = _pane_details(
            self.destination_id, self.panes, self.workspace_names)

        screen.addnstr(1, 2, "FROM", limit, curses.A_DIM)
        screen.addnstr(2, 3, "• " + source_title, limit - 1, curses.A_BOLD)
        screen.addnstr(3, 5, source_place, limit - 3, curses.A_DIM)
        screen.addnstr(4, 3, "↓", limit - 1, curses.A_DIM)
        screen.addnstr(5, 2, "TO", limit, curses.A_DIM)
        screen.addnstr(6, 3, "• " + destination_title, limit - 1, curses.A_BOLD)
        screen.addnstr(7, 5, destination_place, limit - 3, curses.A_DIM)

        notice_row = height - 4
        if self.notice:
            screen.addnstr(notice_row, 2, self.notice, limit, curses.A_BOLD)
        screen.addnstr(height - 3, 2, "─" * limit, limit, curses.A_DIM)
        action_row = height - 1
        screen.addnstr(action_row, 2, "[S]", 3, curses.A_REVERSE | curses.A_BOLD)
        screen.addnstr(action_row, 6, "Split right", 13, curses.A_BOLD)
        screen.addnstr(action_row, 22, "[T]", 3, curses.A_REVERSE | curses.A_BOLD)
        screen.addnstr(action_row, 26, "New tab", 10, curses.A_BOLD)
        screen.addnstr(action_row, 40, "[Q]", 3, curses.A_REVERSE | curses.A_BOLD)
        screen.addnstr(action_row, 44, "Cancel", 10, curses.A_BOLD)
        screen.refresh()

    def place(self, placement):
        try:
            with ctx.Lock():
                outcome = move(self.source_id, self.destination_id, placement)
        except (PaneMoveError, rpc.RpcError, OSError, KeyError, ValueError) as error:
            self.notice = "Move failed: %s" % error
            return False
        if outcome == "moved":
            return True
        if outcome == "source_missing":
            self.notice = "Selected pane no longer exists; move cancelled."
            return True
        if outcome == "destination_missing":
            self.notice = "Destination pane no longer exists. Press q to cancel."
        else:
            self.notice = "Choose another pane to split beside, or press t for a new tab."
        self.reload()
        return False

    def loop(self, screen):
        curses.curs_set(0)
        screen.keypad(True)
        while True:
            self.draw(screen)
            try:
                key = screen.getch()
            except KeyboardInterrupt:
                key = 27
            if key in (27, ord("q")):
                with ctx.Lock():
                    cancel(self.source_id)
                return
            placement = placement_for_key(key)
            if placement and self.place(placement):
                return


def run(argv):
    if argv:
        sys.stderr.write("usage: pane-move\n")
        return 1
    source_id = os.environ.get(SOURCE_ENV)
    destination_id = os.environ.get(DESTINATION_ENV)
    if not source_id or not destination_id:
        sys.stderr.write("pane-move requires source and destination pane IDs\n")
        return 1
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        sys.stderr.write("pane-move needs a terminal; run it through the Mosaic action.\n")
        return 1
    try:
        curses.wrapper(PaneMovePopup(source_id, destination_id).loop)
    except curses.error as exc:
        sys.stderr.write("pane-move could not start (%s)\n" % exc)
        return 1
    return 0
