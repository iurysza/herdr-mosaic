"""Native last-settled tracking from pane.agent_status_changed.

Last settled means the agent finished a turn, not that it was last viewed.
Herdr's event has no timestamp and no previous status, so callers pass receipt
time and we remember the last observed status per pane id.

Counted completions (set last_settled_at to `now`):
  working -> idle
  working -> done

Not completions (status is still updated; any existing last_settled_at is kept):
  first observation of any status, including idle/done
  duplicate idle or done
  done -> idle          (focus/open must not reset the clock)
  idle -> done
  blocked, in or out    (blocked is waiting, not finished)
  unknown, in or out    (unknown is not finished; working -> unknown is interruption)

working -> blocked -> idle does not count: blocked replaces the remembered
status, so the later idle is not a direct working-to-settled edge.
"""

STATUSES = ("idle", "working", "blocked", "done", "unknown")
SETTLED = frozenset(("idle", "done"))


def parse_status_event(data):
    """Return (pane_id, status) or None if the payload cannot be used."""
    if not isinstance(data, dict):
        return None
    pane_id = data.get("pane_id")
    status = data.get("agent_status")
    if not isinstance(pane_id, str) or not pane_id.strip():
        return None
    if status not in STATUSES:
        return None
    return pane_id, status


def parse_pane_id(data):
    if not isinstance(data, dict):
        return None
    pane_id = data.get("pane_id")
    if not isinstance(pane_id, str) or not pane_id.strip():
        pane = data.get("pane")
        if isinstance(pane, dict):
            pane_id = pane.get("pane_id")
    if not isinstance(pane_id, str) or not pane_id.strip():
        return None
    return pane_id


def transition(previous_record, status, now):
    """Pure status step. `now` is receipt wall-clock time (unix seconds)."""
    last_settled_at = None
    prev_status = None
    if isinstance(previous_record, dict):
        prev_status = previous_record.get("status")
        raw = previous_record.get("last_settled_at")
        if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
            last_settled_at = raw
    if prev_status == "working" and status in SETTLED:
        last_settled_at = now
    return {"status": status, "last_settled_at": last_settled_at}


def apply_to_state(st, pane_id, status, now):
    records = st.setdefault("agent_settled", {})
    new = transition(records.get(pane_id), status, now)
    if records.get(pane_id) == new:
        return False
    records[pane_id] = new
    return True


def forget_pane(st, pane_id):
    records = st.get("agent_settled")
    if not isinstance(records, dict) or pane_id not in records:
        return False
    del records[pane_id]
    return True
