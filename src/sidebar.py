"""Publish coloured tab titles and the last-observed-completion clock.

Keep the existing metadata sources during migration. Titles have no TTL, so a
failed refresh cannot erase a working agent's name. Only elapsed values expire.
Model-tier tokens belong to the agent integration and are never written here.
"""

import time

import ctx
import elapsed
import identity
import rpc
import state

TITLE_SOURCE = "agent-sidebar-title"


def title_tokens(agent, tabs, identities):
    """Render exactly one palette slot, clearing the previous colour slots."""
    title = (tabs.get(agent.get("tab_id")) or agent.get("terminal_title_stripped")
             or agent.get("name") or agent.get("display_agent")
             or agent.get("agent") or agent["pane_id"])
    colour = (identities.get(agent.get("workspace_id")) or {}).get("colour")
    # New agents can precede the workspace hook. Use a palette colour until the
    # next reconciliation supplies the space identity rather than hiding a name.
    slot = identity.slot_for_colour(colour or identity.PALETTE[0][1])
    return {"title_" + name: title if name == slot else None
            for name, _ in identity.PALETTE}


def publish(st, agents=None):
    """Publish one round. Caller holds ctx.Lock; this function does not save state."""
    agents = rpc.agents() if agents is None else agents
    tabs = {tab["tab_id"]: tab["label"]
            for tab in rpc.call("tab.list", {}).get("tabs", [])}
    clocks = elapsed.labels(st.get("agent_settled") or {},
                            [agent["pane_id"] for agent in agents], int(time.time()))
    for agent in agents:
        pane_id = agent["pane_id"]
        rpc.call("pane.report_metadata", {
            "pane_id": pane_id, "source": TITLE_SOURCE,
            "tokens": title_tokens(agent, tabs, st.get("identities") or {}),
        })
        rpc.call("pane.report_metadata", {
            "pane_id": pane_id, "source": elapsed.SOURCE,
            "tokens": {"elapsed": clocks[pane_id]}, "ttl_ms": elapsed.TTL_MS,
        })
    return len(agents)


def clear(agents):
    """Clear only Mosaic's title/clock sources during explicit uninstall."""
    for agent in agents:
        for source, tokens in (
            (TITLE_SOURCE, {"title_" + name: None for name, _ in identity.PALETTE}),
            (elapsed.SOURCE, {"elapsed": None}),
        ):
            _, error = rpc.try_call("pane.report_metadata", {
                "pane_id": agent["pane_id"], "source": source, "tokens": tokens,
            })
            if error:
                ctx.warn("sidebar clear failed for %s: %s" % (agent["pane_id"], error))


def publish_once():
    with ctx.Lock():
        st = state.load()
        if st.get("sidebar_installed"):
            publish(st)
    return 0
