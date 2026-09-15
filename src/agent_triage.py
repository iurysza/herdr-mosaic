"""Select idle agents and identify stale agent sessions.

The pure selection functions use Mosaic's observed ``working -> idle|done``
settlement times. They never infer an age for an agent Mosaic first discovers
while it is already settled.
"""

import re
import time

import ctx
import rpc
import state as state_mod

SETTLED = frozenset(("idle", "done"))
_DURATION = re.compile(r"^([1-9][0-9]*)([smhdw])$")
_DURATION_SECONDS = {
    "s": 1,
    "m": 60,
    "h": 60 * 60,
    "d": 24 * 60 * 60,
    "w": 7 * 24 * 60 * 60,
}


def parse_duration(value):
    """Parse an explicit positive duration such as ``8h`` or ``2d``."""
    if not isinstance(value, str):
        return None
    match = _DURATION.match(value.strip().lower())
    if not match:
        return None
    return int(match.group(1)) * _DURATION_SECONDS[match.group(2)]


def settled_at(state, pane_id):
    """Return a trustworthy observed settlement timestamp, or None."""
    record = (state.get("agent_settled") or {}).get(pane_id)
    value = record.get("last_settled_at") if isinstance(record, dict) else None
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def _settled_agents(agents, state):
    return [agent for agent in agents
            if agent.get("agent_status") in SETTLED
            and isinstance(agent.get("pane_id"), str)
            and agent.get("pane_id")]


def idle_cycle_candidates(agents, state):
    """Return live settled agents, newest observed settlement first.

    Untracked agents follow tracked ones in stable pane-ID order. That retains a
    useful cycle after Mosaic is installed without pretending their idle ages are
    known.
    """
    def key(agent):
        observed = settled_at(state, agent["pane_id"])
        return (observed is None, -(observed or 0), agent["pane_id"])

    return sorted(_settled_agents(agents, state), key=key)


def next_idle_agent(agents, state, previous_pane_id=None):
    """Select the next settled agent, wrapping and avoiding the focused one."""
    candidates = idle_cycle_candidates(agents, state)
    if not candidates:
        return None
    focused = next((agent.get("pane_id") for agent in candidates
                    if agent.get("focused")), None)
    pane_ids = [agent["pane_id"] for agent in candidates]
    if previous_pane_id in pane_ids:
        start = (pane_ids.index(previous_pane_id) + 1) % len(candidates)
    else:
        start = 0
    for offset in range(len(candidates)):
        candidate = candidates[(start + offset) % len(candidates)]
        if candidate["pane_id"] != focused:
            return candidate
    return None


def prune_rows(agents, state, stale_after, protected_pane_id=None, now=None):
    """Return settled sessions oldest first, with pruning eligibility.

    Agents with no observed settlement time remain visible but cannot be selected.
    A protected pane is the agent focused before the pruner popup opened.
    """
    now = int(time.time() if now is None else now)
    rows = []
    for agent in _settled_agents(agents, state):
        pane_id = agent["pane_id"]
        observed = settled_at(state, pane_id)
        age = None if observed is None else max(0, now - observed)
        rows.append({
            "agent": agent,
            "pane_id": pane_id,
            "settled_at": observed,
            "age": age,
            "eligible": (stale_after is not None and age is not None
                         and age >= stale_after and pane_id != protected_pane_id),
            "protected": pane_id == protected_pane_id,
        })
    return sorted(rows, key=lambda row: (row["settled_at"] is None,
                                         row["settled_at"] or 0,
                                         row["pane_id"]))


def close_selected(pane_ids, stale_after, protected_pane_id=None, now=None):
    """Close only sessions that remain eligible at confirmation time.

    Returns ``(closed, skipped, failures)``. The re-read prevents a stale popup
    from closing an agent that has started working, become blocked, or is no
    longer beyond the selected threshold.
    """
    selected = set(pane_ids or ())
    if not selected:
        return [], [], []
    with ctx.Lock():
        state = state_mod.load()
        current = {row["pane_id"]: row for row in prune_rows(
            rpc.agents(), state, stale_after, protected_pane_id, now=now)}
        closed, skipped, failures = [], [], []
        for pane_id in pane_ids:
            row = current.get(pane_id)
            if not row or not row["eligible"]:
                skipped.append(pane_id)
                continue
            _result, error = rpc.try_call("pane.close", {"pane_id": pane_id})
            if error:
                failures.append((pane_id, str(error)))
            else:
                closed.append(pane_id)
        return closed, skipped, failures
