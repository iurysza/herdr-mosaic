"""Install a plugin-owned Agent projection.

Scope (all spaces vs current workspace) and sort (activity vs spaces) are
independent. Filter uses Herdr's live `current_workspace_id` context. Sort is
always sent: any plugin view disables Herdr's native Agents sort button, even
when the label is omitted.
"""

import ctx
import rpc

SOURCE = ctx.PLUGIN_ID
SCOPES = ("all", "current")
SORTS = ("activity", "spaces")
LABELS = {"activity": "Activity", "spaces": "Spaces"}

# Stable tails keep equal-attention rows from shuffling across republish.
SORT_ACTIVITY = [
    {"field": "attention", "order": "desc"},
    {"field": "state_change_seq", "order": "desc"},
    {"field": "workspace_order", "order": "asc"},
    {"field": "tab_order", "order": "asc"},
    {"field": "pane_order", "order": "asc"},
]

SORT_SPACES = [
    {"field": "workspace_order", "order": "asc"},
    {"field": "attention", "order": "desc"},
    {"field": "tab_order", "order": "asc"},
    {"field": "pane_order", "order": "asc"},
]


def normalize_scope(mode):
    return "current" if mode == "current" else "all"


def normalize_sort(sort):
    return "activity" if sort == "activity" else "spaces"


def definition(mode="all", sort="spaces"):
    """Build the agent.view.set params for a scope and sort."""
    mode = normalize_scope(mode)
    sort = normalize_sort(sort)
    params = {
        "source": SOURCE,
        "label": LABELS[sort],
        "sort": [dict(s) for s in (
            SORT_ACTIVITY if sort == "activity" else SORT_SPACES)],
    }
    if mode == "current":
        # Herdr resolves this against the live focused workspace.
        params["filter"] = {
            "op": "eq",
            "field": "workspace_id",
            "value": {"context": "current_workspace_id"},
        }
    return params


def install(mode="all", sort="spaces"):
    return rpc.try_call("agent.view.set", definition(mode, sort))


def clear():
    """Clear only this plugin's view; Herdr scopes the clear by source."""
    return rpc.try_call("agent.view.clear", {"source": SOURCE})
