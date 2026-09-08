"""Publish time since the last observed completion, never time since focus.

The existing refresh service calls this command while Window Manager is enabled.
Cadence/expiry receipt: herdr-agent-elapsed measured 20-pane rounds at 602 ms
median, 940 ms maximum on 2026-09-04; its 30-second refresh uses a 45-second TTL.
Keep that expiry and its existing source during the publisher handover so old
clock values are replaced rather than competing with a second metadata source.
"""

SOURCE = "agent-elapsed"
TTL_MS = 45000
PAD = "\u2800"


def format_elapsed(seconds):
    """Keep the existing sidebar's rounding and units."""
    if seconds < 30:
        return "now"
    if seconds < 3600:
        return "%dm" % ((seconds + 30) // 60)
    if seconds < 86400:
        return "%dh" % ((seconds + 1800) // 3600)
    return "%dd" % ((seconds + 43200) // 86400)


def labels(records, pane_ids, now):
    """Return labels or null clears. No completion means no invented age."""
    result = {}
    for pane_id in pane_ids:
        record = records.get(pane_id)
        at = record.get("last_settled_at") if isinstance(record, dict) else None
        if isinstance(at, int) and not isinstance(at, bool) and at >= 0:
            result[pane_id] = format_elapsed(max(0, now - at))
        else:
            result[pane_id] = None
    width = max((len(label) for label in result.values() if label), default=0)
    if width > 2:
        result = {pane: label + PAD * (width - len(label)) if label else None
                  for pane, label in result.items()}
    return result


def publish():
    """Read durable timestamps and update only elapsed tokens under plugin lock."""
    import time
    import ctx
    import rpc
    import state

    with ctx.Lock():
        agents = rpc.agents()
        records = state.load()["agent_settled"]
        values = labels(records, [a["pane_id"] for a in agents], int(time.time()))
        for pane_id, label in values.items():
            rpc.call("pane.report_metadata", {
                "pane_id": pane_id, "source": SOURCE,
                "tokens": {"elapsed": label}, "ttl_ms": TTL_MS,
            })
    return 0
