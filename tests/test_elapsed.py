"""Clock rendering and isolated publication boundary tests."""
import os
import time
from unittest.mock import patch

from test_plugin import Base


def cell(label):
    import elapsed
    return elapsed.fit_width(label)


class TestElapsed(Base):
    def test_existing_rounding_fits_three_cells(self):
        import elapsed
        for seconds, expected in ((0, "now"), (29, "now"), (30, cell("1m")),
                                  (90, cell("2m")), (3599, "60m"), (3600, cell("1h")),
                                  (5400, cell("2h")), (86400, cell("1d"))):
            self.assertEqual(elapsed.format_elapsed(seconds), expected)
            self.assertEqual(len(elapsed.format_elapsed(seconds)), elapsed.WIDTH)

    def test_short_values_pad_only_remaining_cells(self):
        import elapsed
        self.assertEqual(elapsed.fit_width("2m"), "2m" + elapsed.PAD)
        self.assertEqual(len(elapsed.fit_width("2m")), 3)
        self.assertNotEqual(elapsed.fit_width("2m"), "2m" + elapsed.PAD * 3)

    def test_three_cell_values_are_not_padded(self):
        import elapsed
        for label in ("now", "10m", "60m", "24h", "10d", "99d"):
            self.assertEqual(elapsed.fit_width(label), label)
            self.assertEqual(len(label), elapsed.WIDTH)

    def test_old_ages_saturate_at_99d(self):
        import elapsed
        self.assertEqual(elapsed.format_elapsed(99 * 86400), "99d")
        self.assertEqual(elapsed.format_elapsed(100 * 86400), "99d")
        self.assertEqual(elapsed.format_elapsed(400 * 86400), "99d")

    def test_unknown_completion_publishes_blank_not_an_age(self):
        import elapsed
        self.assertEqual(elapsed.labels({}, ["p1"], 100), {"p1": elapsed.BLANK})
        self.assertEqual(elapsed.BLANK, elapsed.PAD * elapsed.WIDTH)
        self.assertEqual(len(elapsed.BLANK), elapsed.WIDTH)
        self.assertNotIn(" ", elapsed.BLANK)
        for value in (None, True, "12", -1):
            self.assertEqual(elapsed.labels(
                {"p1": {"last_settled_at": value}}, ["p1"], 100),
                {"p1": elapsed.BLANK})

    def test_status_does_not_change_age(self):
        import elapsed
        for status in ("working", "idle", "done", "blocked", "unknown"):
            self.assertEqual(elapsed.labels({"p1": {
                "last_settled_at": 100, "status": status,
            }}, ["p1"], 220), {"p1": cell("2m")})

    def test_future_timestamp_clamps_to_now(self):
        import elapsed
        self.assertEqual(elapsed.labels(
            {"p1": {"last_settled_at": 110}}, ["p1"], 100), {"p1": "now"})

    def test_missing_and_short_clocks_share_three_cells(self):
        import elapsed
        records = {"p1": {"last_settled_at": 1}, "p2": {"last_settled_at": 599}}
        self.assertEqual(elapsed.labels(records, ["p1", "p2", "p3"], 601),
                         {"p1": "10m", "p2": "now", "p3": elapsed.BLANK})
        records["p2"]["last_settled_at"] = 541
        self.assertEqual(elapsed.labels(records, ["p1", "p2"], 601)["p2"], cell("1m"))
        for label in elapsed.labels(records, ["p1", "p2", "p3"], 601).values():
            self.assertEqual(len(label), elapsed.WIDTH)

    def test_native_transition_to_clock_end_to_end(self):
        import agent_tracker
        import elapsed
        rec = agent_tracker.transition(None, "working", 10)
        rec = agent_tracker.transition(rec, "done", 20)
        rec = agent_tracker.transition(rec, "idle", 30)
        self.assertEqual(elapsed.labels({"p": rec}, ["p"], 140), {"p": cell("2m")})
        self.assertEqual(elapsed.labels({"p": rec}, ["p"], 200), {"p": cell("3m")})
        self.assertEqual(rec["last_settled_at"], 20)

    def test_command_publishes_blank_for_missing_and_does_not_write_state(self):
        import main
        import ctx
        import elapsed
        import rpc
        import state
        st = state.default_state()
        st["agent_settled"] = {"p1": {"status": "idle", "last_settled_at": 100}}
        state.save(st)
        path = os.path.join(ctx.state_dir(), "state.json")
        with open(path, "rb") as fh:
            before = fh.read()
        calls = []
        def report(method, params):
            calls.append((method, params))
            return {}
        with patch.object(rpc, "agents", return_value=[{"pane_id": "p1"}, {"pane_id": "p2"}]), \
                patch.object(rpc, "call", side_effect=report), patch.object(time, "time", return_value=220):
            self.assertEqual(main.main(["elapsed-publish"]), 0)
        self.assertEqual(calls, [
            ("pane.report_metadata", {"pane_id": "p1", "source": "agent-elapsed",
             "tokens": {"elapsed": cell("2m")}, "ttl_ms": 45000}),
            ("pane.report_metadata", {"pane_id": "p2", "source": "agent-elapsed",
             "tokens": {"elapsed": elapsed.BLANK}, "ttl_ms": 45000}),
        ])
        with open(path, "rb") as fh:
            self.assertEqual(fh.read(), before)

    def test_publication_failure_is_not_reported_as_success(self):
        import main
        import rpc
        with patch.object(rpc, "agents", return_value=[{"pane_id": "p1"}]), \
                patch.object(rpc, "call", side_effect=rpc.RpcError("rejected", "fixture")):
            self.assertEqual(main.main(["elapsed-publish"]), 1)
