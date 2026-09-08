"""Pane layout trees and presets.

Adapted from herdr-pane-layouts (iurysza/herdr-pane-layouts) commit
0ef0a8d5d463757f06037551fc1f5ef6dfde478d. Behaviour is preserved; syntax is
Python 3.6-compatible.
"""


def pane(pane_id):
    return {"type": "pane", "pane_id": pane_id}


def split(direction, ratio, first, second):
    return {
        "type": "split",
        "direction": direction,
        "ratio": ratio,
        "first": first,
        "second": second,
    }


def balanced(ids, direction):
    if len(ids) == 1:
        return pane(ids[0])
    midpoint = len(ids) // 2
    return split(
        direction,
        midpoint / float(len(ids)),
        balanced(ids[:midpoint], direction),
        balanced(ids[midpoint:], direction),
    )


def tiled(ids, direction="right"):
    if len(ids) == 1:
        return pane(ids[0])
    midpoint = (len(ids) + 1) // 2
    alternate = "down" if direction == "right" else "right"
    return split(
        direction,
        midpoint / float(len(ids)),
        tiled(ids[:midpoint], alternate),
        tiled(ids[midpoint:], alternate),
    )


def same(first, second):
    if first["type"] != second["type"]:
        return False
    if first["type"] == "pane":
        return first.get("pane_id") == second.get("pane_id")
    return (
        first["direction"] == second["direction"]
        and abs(float(first["ratio"]) - float(second["ratio"])) < 0.01
        and same(first["first"], second["first"])
        and same(first["second"], second["second"])
    )


def pane_ids(node):
    if node["type"] == "pane":
        pane_id = node.get("pane_id")
        if pane_id:
            return [pane_id]
        raise ValueError("layout contains a pane without an id")
    return pane_ids(node["first"]) + pane_ids(node["second"])


def first_pane(node):
    while node["type"] == "split":
        node = node["first"]
    pane_id = node.get("pane_id")
    if pane_id:
        return pane_id
    raise ValueError("layout contains a pane without an id")


def insertion_plan(node):
    if node["type"] == "pane":
        return []
    move = (
        first_pane(node["first"]),
        first_pane(node["second"]),
        node["direction"],
        float(node["ratio"]),
    )
    return [move] + insertion_plan(node["first"]) + insertion_plan(node["second"])


def presets(ids):
    candidates = [
        ("even-vertical", balanced(ids, "right")),
        ("even-horizontal", balanced(ids, "down")),
    ]
    if len(ids) > 1:
        candidates += [
            ("main-left", split("right", 0.6, pane(ids[0]), balanced(ids[1:], "down"))),
            ("main-top", split("down", 0.6, pane(ids[0]), balanced(ids[1:], "right"))),
            ("tiled", tiled(ids)),
        ]

    unique = []
    for name, tree in candidates:
        if not any(same(tree, existing) for _n, existing in unique):
            unique.append((name, tree))
    return unique
