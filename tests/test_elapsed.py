"""Clock rendering and isolated publication boundary tests."""
import json
import os
import time
from unittest.mock import patch

from test_plugin import Base


class TestElapsed(Base):
    def test_existing_rounding(self):
        import elapsed
        for seconds, expected in ((0, "now"), (29, "now"), (30, "1m"),
                                  (90, "2m"), (3599, "60m"), (3600, "1h"),
                                  (5400, "2h"), (86400, "1d")):
            self.assertEqual(elapsed.format_elapsed(seconds), expected)

    def test_unknown_completion_clears_previous_clock(self):
        import elapsed
        self.assertEqual(elapsed.labels({}, ["p1"], 100), {"p1": None})
        for value in (None, True, "12", -1):
            self.assertEqual(elapsed.labels(
                {"p1": {"last_settled_at": value}}, ["p1"], 100), {"p1": None})

    def test_status_does_not_change_age(self):
        import elapsed
        for status in ("working", "idle", "done", "blocked", "unknown"):
            self.assertEqual(elapsed.labels({"p1": {
                "last_settled_at": 100, "status": status,
            }}, ["p1"], 220), {"p1": "2m"})

    def test_future_timestamp_clamps_to_now(self):
        import elapsed
        self.assertEqual(elapsed.labels(
            {"p1": {"last_settled_at": 110}}, ["p1"], 100), {"p1": "now"})

    def test_padding_matches_existing_style_without_padding_missing_values(self):
        import elapsed
        records = {"p1": {"last_settled_at": 1}, "p2": {"last_settled_at": 599}}
        self.assertEqual(elapsed.labels(records, ["p1", "p2", "p3"], 601),
                         {"p1": "10m", "p2": "now", "p3": None})
        records["p2"]["last_settled_at"] = 541
        self.assertEqual(elapsed.labels(records, ["p1", "p2"], 601)["p2"], "1m\u2800")

    def test_native_transition_to_clock_end_to_end(self):
        import agent_tracker
        import elapsed
        rec = agent_tracker.transition(None, "working", 10)
        rec = agent_tracker.transition(rec, "done", 20)
        rec = agent_tracker.transition(rec, "idle", 30)
        self.assertEqual(elapsed.labels({"p": rec}, ["p"], 140), {"p": "2m"})
        self.assertEqual(elapsed.labels({"p": rec}, ["p"], 200), {"p": "3m"})
        self.assertEqual(rec["last_settled_at"], 20)

    def test_command_publishes_only_elapsed_and_does_not_write_state(self):
        import main
        import ctx
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
             "tokens": {"elapsed": "2m"}, "ttl_ms": 45000}),
            ("pane.report_metadata", {"pane_id": "p2", "source": "agent-elapsed",
             "tokens": {"elapsed": None}, "ttl_ms": 45000}),
        ])
        with open(path, "rb") as fh:
            self.assertEqual(fh.read(), before)

    def test_publication_failure_is_not_reported_as_success(self):
        import main
        import rpc
        with patch.object(rpc, "agents", return_value=[{"pane_id": "p1"}]), \
                patch.object(rpc, "call", side_effect=rpc.RpcError("rejected", "fixture")):
            self.assertEqual(main.main(["elapsed-publish"]), 1)
