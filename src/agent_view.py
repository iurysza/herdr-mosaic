"""Install a plugin-owned Agent projection so same-space agents are contiguous.

This uses Herdr's native declarative agent view (`agent.view.set`) rather than
any local agent database, so detection, status, notifications and attention
counts are entirely untouched -- only ordering (and optionally scope) changes.
"""

import ctx
import rpc

SOURCE = ctx.PLUGIN_ID
LABEL_ALL = "Spaces"
LABEL_CURRENT = "This Space"

SORT_BY_SPACE = [
    {"field": "workspace_order", "order": "asc"},
    {"field": "tab_order", "order": "asc"},
    {"field": "pane_order", "order": "asc"},
]


def definition(mode="all"):
    """Build the agent.view.set params for a mode."""
    params = {
        "source": SOURCE,
        "label": LABEL_CURRENT if mode == "current" else LABEL_ALL,
        "sort": [dict(s) for s in SORT_BY_SPACE],
    }
    if mode == "current":
        # Herdr resolves this against the live focused workspace.
        params["filter"] = {
            "op": "eq",
            "field": "workspace_id",
            "value": {"context": "current_workspace_id"},
        }
    return params


def install(mode="all"):
    return rpc.try_call("agent.view.set", definition(mode))


def clear():
    """Clear only this plugin's view; Herdr scopes the clear by source."""
    return rpc.try_call("agent.view.clear", {"source": SOURCE})
