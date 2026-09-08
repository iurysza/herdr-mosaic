"""Process-preserving pane reshape and resize.

Adapted from herdr-pane-layouts `src/cli.py` (commit
0ef0a8d5d463757f06037551fc1f5ef6dfde478d). Mutations run under ctx.Lock and
talk to Herdr through rpc.py.
"""

import os
import sys

import ctx
import layouts
import rpc


RESIZE_AMOUNT = 0.02
RESIZE_DIRECTIONS = {
    "resize-left": "left",
    "resize-down": "down",
    "resize-up": "up",
    "resize-right": "right",
}


class LayoutError(RuntimeError):
    pass


def _notify(message):
    rpc.try_call(
        "notification.show",
        {"title": "Mosaic layouts failed", "body": message, "sound": "none"},
    )


def _pane_context():
    pane_id = os.environ.get("HERDR_PANE_ID")
    if pane_id:
        return pane_id
    c = ctx.invocation_context()
    return c.get("focused_pane_id") or c.get("pane_id")


def _export_layout(tab_id=None):
    pane_id = None if tab_id else _pane_context()
    params = {}
    if tab_id:
        params["tab_id"] = tab_id
    elif pane_id:
        params["pane_id"] = pane_id
    result = rpc.call("layout.export", params)
    layout = (result or {}).get("layout")
    if not layout:
        raise LayoutError("layout.export returned no layout")
    return layout


def _tab_destination(tab_id, target_pane_id, direction, ratio):
    return {
        "type": "tab",
        "tab_id": tab_id,
        "target_pane_id": target_pane_id,
        "split": direction,
        "ratio": ratio,
    }


def _move(pane_id, destination, focus=False):
    result = rpc.call(
        "pane.move",
        {"pane_id": pane_id, "destination": destination, "focus": focus},
    )
    move_result = (result or {}).get("move_result") or {}
    if not move_result.get("changed"):
        raise LayoutError("pane.move: %s" % (move_result.get("reason") or "move rejected"))
    return move_result


def recover(staging_tab, original_tab, focused_pane):
    staged = layouts.pane_ids(_export_layout(tab_id=staging_tab)["root"])
    target = layouts.first_pane(_export_layout(tab_id=original_tab)["root"])
    for pane_id in staged:
        _move(
            pane_id,
            _tab_destination(original_tab, target, "right", 0.5),
            focus=pane_id == focused_pane,
        )


def reshape(layout, target):
    ids = layouts.pane_ids(layout["root"])
    if len(ids) < 2 or layouts.same(layout["root"], target):
        return
    if layout.get("zoomed"):
        raise LayoutError("unzoom the tab before changing its layout")

    tab_id = layout["tab_id"]
    focused = layout["focused_pane_id"]
    anchor = layouts.first_pane(target)
    staged = [pane_id for pane_id in ids if pane_id != anchor]
    current = dict((pane_id, pane_id) for pane_id in ids)
    staging_tab = None

    try:
        first = staged[0]
        moved = _move(
            first,
            {
                "type": "new_tab",
                "workspace_id": layout["workspace_id"],
                "label": "layout-staging-%d" % os.getpid(),
            },
        )
        created = moved.get("created_tab") or {}
        staging_tab = created.get("tab_id")
        if not staging_tab:
            raise LayoutError("pane.move did not create a staging tab")
        current[first] = moved["pane"]["pane_id"]
        staging_target = current[first]

        for pane_id in staged[1:]:
            moved = _move(
                current[pane_id],
                _tab_destination(staging_tab, staging_target, "right", 0.5),
            )
            current[pane_id] = moved["pane"]["pane_id"]

        for target_id, source_id, direction, ratio in layouts.insertion_plan(target):
            moved = _move(
                current[source_id],
                _tab_destination(tab_id, current[target_id], direction, ratio),
                focus=source_id == focused,
            )
            current[source_id] = moved["pane"]["pane_id"]

        staging_tab = None
    except Exception:
        if staging_tab:
            try:
                recover(staging_tab, tab_id, current[focused])
            except Exception as error:
                sys.stderr.write(
                    "mosaic: recovery failed; panes remain in %s: %s\n"
                    % (staging_tab, error)
                )
        raise


def target_for(action, layout):
    choices = layouts.presets(layouts.pane_ids(layout["root"]))
    if action == "equalize":
        return choices[0][1]
    current = -1
    for index, (_name, tree) in enumerate(choices):
        if layouts.same(layout["root"], tree):
            current = index
            break
    return choices[(current + 1) % len(choices)][1]


def run_action(action):
    """Execute one layout action. Caller holds ctx.Lock."""
    direction = RESIZE_DIRECTIONS.get(action)
    if direction:
        pane_id = _pane_context()
        if not pane_id:
            raise LayoutError("resize action requires a pane context")
        rpc.call(
            "pane.resize",
            {"pane_id": pane_id, "direction": direction, "amount": RESIZE_AMOUNT},
        )
        return 0
    if action in ("equalize", "cycle"):
        current = _export_layout()
        reshape(current, target_for(action, current))
        return 0
    raise LayoutError("unknown layout action %r" % action)


def run(argv):
    action = argv[0] if argv else ""
    try:
        with ctx.Lock():
            return run_action(action)
    except (LayoutError, rpc.RpcError, OSError, KeyError, ValueError) as error:
        ctx.warn("layouts: %s" % error)
        _notify(str(error))
        print("mosaic: %s" % error, file=sys.stderr)
        return 1
