"""Native last-settled tracking from pane.agent_detected and status changes.

Last settled means time since launch or the latest counted completion, never
time since the agent was last viewed.

Herdr 0.9.0 pane.agent_detected and pane.agent_status_changed payloads have
no launch or completion timestamp. Callers pass receipt time as `now`.
pane.agent_detected also fires on release (`released: true`); those are not
launches.

Launch initialisation (set last_settled_at to `now` once):
  first occupancy from pane.agent_detected
  first occupancy from pane.agent_status_changed when no record exists

An existing occupancy record without a timestamp is left alone. That time
would not be the agent's launch, and this plugin does not backfill it.

Counted completions (set last_settled_at to `now`):
  working -> idle
  working -> done

Not completions (status is still updated; any existing last_settled_at is kept):
  later observations of any status after occupancy exists
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


def _timestamp(raw):
    if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
        return raw
    return None


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


def parse_launch_event(data):
    """Return pane_id for a new-agent detect, or None.

    `released: true` is an agent leaving the pane, not a launch. False is
    omitted from the payload (`skip_serializing_if` on Not::not).
    """
    if not isinstance(data, dict) or data.get("released") is True:
        return None
    return parse_pane_id(data)


def launch(previous_record, now):
    """Pure detect step. Does not invent a time for an existing occupancy."""
    if isinstance(previous_record, dict):
        status = previous_record.get("status")
        if status not in STATUSES:
            status = None
        return {
            "status": status,
            "last_settled_at": _timestamp(previous_record.get("last_settled_at")),
        }
    return {"status": None, "last_settled_at": now}


def transition(previous_record, status, now):
    """Pure status step. `now` is receipt wall-clock time (unix seconds)."""
    last_settled_at = None
    prev_status = None
    if isinstance(previous_record, dict):
        prev_status = previous_record.get("status")
        last_settled_at = _timestamp(previous_record.get("last_settled_at"))
    else:
        last_settled_at = now
    if prev_status == "working" and status in SETTLED:
        last_settled_at = now
    return {"status": status, "last_settled_at": last_settled_at}


def apply_launch_to_state(st, pane_id, now):
    records = st.setdefault("agent_settled", {})
    new = launch(records.get(pane_id), now)
    if records.get(pane_id) == new:
        return False
    records[pane_id] = new
    return True


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
