"""Publish time since the last observed completion, never time since focus.

Mosaic's sidebar worker uses this renderer. The elapsed-publish command remains
available for compatibility and diagnostics; no external service is required.
Cadence/expiry receipt: herdr-agent-elapsed measured 20-pane rounds at 602 ms
median, 940 ms maximum on 2026-09-04; its 30-second refresh uses a 45-second TTL.
Keep that expiry and its existing source during the publisher handover so old
clock values are replaced rather than competing with a second metadata source.

Column receipt: the Agents elapsed token is always published as exactly 3
terminal cells. That width is the product requirement, not a measured sidebar
average. Short labels take U+2800 only for the remaining cells. A missing clock
is three U+2800 cells, not an invented age and not ASCII spaces. Herdr 0.8.2
trims ASCII spaces, NBSP, and figure spaces to a token clear. Ages that would
need a fourth cell stay `99d`.
"""

SOURCE = "agent-elapsed"
TTL_MS = 45000
WIDTH = 3
PAD = "\u2800"
BLANK = PAD * WIDTH


def fit_width(label):
    """Right-pad with U+2800 so a published clock occupies WIDTH cells."""
    width = len(label)
    if width >= WIDTH:
        return label
    return label + PAD * (WIDTH - width)


def format_elapsed(seconds):
    """Keep the existing sidebar's rounding and units, then fit WIDTH cells."""
    if seconds < 30:
        label = "now"
    elif seconds < 3600:
        label = "%dm" % ((seconds + 30) // 60)
    elif seconds < 86400:
        label = "%dh" % ((seconds + 1800) // 3600)
    else:
        days = (seconds + 43200) // 86400
        if days > 99:
            days = 99
        label = "%dd" % days
    return fit_width(label)


def labels(records, pane_ids, now):
    """Return 3-cell labels. No completion means BLANK, not an invented age."""
    result = {}
    for pane_id in pane_ids:
        record = records.get(pane_id)
        at = record.get("last_settled_at") if isinstance(record, dict) else None
        if isinstance(at, int) and not isinstance(at, bool) and at >= 0:
            result[pane_id] = format_elapsed(max(0, now - at))
        else:
            result[pane_id] = BLANK
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
