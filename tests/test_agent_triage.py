"""Idle-agent cycling and stale-agent pruning contracts."""

import io
import os
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from test_plugin import Base


class AgentTriageBase(Base):
    def agent(self, pane_id, status="idle", settled=None, focused=False):
        agent = {
            "pane_id": pane_id,
            "agent_status": status,
            "agent": "pi",
            "terminal_title_stripped": "Task " + pane_id,
            "workspace_id": "w1",
            "tab_id": "w1:t1",
        }
        if focused:
            agent["focused"] = True
        return agent

    def state(self, *records):
        import state
        out = state.default_state()
        for pane_id, status, settled in records:
            out["agent_settled"][pane_id] = {
                "status": status,
                "last_settled_at": settled,
            }
        return out


class TestSelection(AgentTriageBase):
    def test_duration_parser_requires_a_positive_explicit_unit(self):
        import agent_triage
        self.assertEqual(agent_triage.parse_duration("8h"), 8 * 60 * 60)
        self.assertEqual(agent_triage.parse_duration("2D"), 2 * 24 * 60 * 60)
        for value in (None, "", "0h", "8", "1.5h", "hour", "-1d"):
            self.assertIsNone(agent_triage.parse_duration(value), value)

    def test_cycle_starts_with_newest_then_wraps(self):
        import agent_triage
        agents = [self.agent("p-old"), self.agent("p-new"), self.agent("p-mid")]
        state = self.state(("p-old", "idle", 10), ("p-mid", "done", 20),
                           ("p-new", "idle", 30))
        first = agent_triage.next_idle_agent(agents, state)
        second = agent_triage.next_idle_agent(agents, state, first["pane_id"])
        third = agent_triage.next_idle_agent(agents, state, second["pane_id"])
        fourth = agent_triage.next_idle_agent(agents, state, third["pane_id"])
        self.assertEqual([first["pane_id"], second["pane_id"], third["pane_id"],
                          fourth["pane_id"]], ["p-new", "p-mid", "p-old", "p-new"])

    def test_cycle_skips_focused_agent_and_places_untracked_last(self):
        import agent_triage
        agents = [self.agent("p-current", focused=True), self.agent("p-known"),
                  self.agent("p-untracked")]
        state = self.state(("p-current", "idle", 30), ("p-known", "done", 20))
        self.assertEqual(agent_triage.next_idle_agent(agents, state)["pane_id"], "p-known")
        ordered = [a["pane_id"] for a in agent_triage.idle_cycle_candidates(agents, state)]
        self.assertEqual(ordered, ["p-current", "p-known", "p-untracked"])

    def test_prune_rows_are_oldest_first_and_protect_current_agent(self):
        import agent_triage
        agents = [self.agent("p-fresh"), self.agent("p-old"), self.agent("p-current"),
                  self.agent("p-untracked"), self.agent("p-work", "working")]
        state = self.state(("p-fresh", "idle", 950), ("p-old", "done", 100),
                           ("p-current", "idle", 10), ("p-untracked", "idle", None))
        rows = agent_triage.prune_rows(agents, state, 100, "p-current", now=1000)
        self.assertEqual([r["pane_id"] for r in rows],
                         ["p-current", "p-old", "p-fresh", "p-untracked"])
        self.assertEqual([r["eligible"] for r in rows], [False, True, False, False])
        self.assertTrue(rows[0]["protected"])

    def test_prune_never_marks_anything_eligible_without_a_threshold(self):
        import agent_triage
        rows = agent_triage.prune_rows(
            [self.agent("p1")], self.state(("p1", "idle", 1)), None, now=1000)
        self.assertFalse(rows[0]["eligible"])


class TestPrunerLayout(AgentTriageBase):
    def test_pruner_rows_use_stable_columns_without_eligibility_text(self):
        import prune
        pruner = prune.Pruner.__new__(prune.Pruner)
        pruner.selected = set()
        pruner.workspaces = {"w1": "Agent team"}
        pruner.tabs = {"w1:t1": "Build Session Queries"}
        row = {
            "pane_id": "p1",
            "age": None,
            "eligible": False,
            "agent": self.agent("p1"),
        }

        headings = pruner._column_headings(120)
        line = pruner._line(row, 120)

        self.assertEqual(headings.index("SESSION"), line.index("Agent team"))
        self.assertEqual(line[4:13], "        —")
        self.assertEqual(line[14:21], "idle   ")
        self.assertEqual(line[22:31], "pi       ")
        self.assertNotIn("untracked", line)
        self.assertNotIn("threshold", line)


class TestCommands(AgentTriageBase):
    def test_next_idle_agent_focuses_public_target_then_records_cursor(self):
        import main
        import state
        state.save(self.state(("p1", "idle", 20), ("p2", "done", 10)))
        agents = [self.agent("p1"), self.agent("p2")]
        with mock.patch("rpc.agents", return_value=agents), \
                mock.patch("rpc.try_call", return_value=({}, None)) as call, \
                redirect_stdout(io.StringIO()):
            self.assertEqual(main.cmd_next_idle_agent([]), 0)
        call.assert_called_once_with("agent.focus", {"target": "p1"})
        self.assertEqual(state.load()["idle_cycle_last_pane_id"], "p1")

    def test_next_idle_agent_does_not_write_cursor_when_focus_fails(self):
        import main
        import state
        before = self.state(("p1", "idle", 20))
        state.save(before)
        with mock.patch("rpc.agents", return_value=[self.agent("p1")]), \
                mock.patch("rpc.try_call", return_value=(None, RuntimeError("nope"))), \
                redirect_stderr(io.StringIO()):
            self.assertEqual(main.cmd_next_idle_agent([]), 1)
        self.assertIsNone(state.load()["idle_cycle_last_pane_id"])

    def test_pruner_open_protects_the_agent_focused_before_popup(self):
        import main
        agents = [self.agent("p1", focused=True), self.agent("p2")]
        with mock.patch("rpc.agents", return_value=agents), \
                mock.patch("rpc.try_call", return_value=({}, None)) as call:
            self.assertEqual(main.cmd_prune_stale_agents([]), 0)
        method, params = call.call_args[0]
        self.assertEqual(method, "plugin.pane.open")
        self.assertEqual(params["entrypoint"], "prune")
        self.assertEqual(params["env"], {"MOSAIC_PRUNE_PROTECTED_PANE": "p1"})

    def test_confirmation_rechecks_liveness_and_eligibility_before_closing(self):
        import agent_triage
        import state
        state.save(self.state(("p-old", "idle", 1), ("p-now-working", "idle", 1)))
        agents = [self.agent("p-old", "idle"), self.agent("p-now-working", "working")]
        with mock.patch("rpc.agents", return_value=agents), \
                mock.patch("rpc.try_call", return_value=({}, None)) as call:
            closed, skipped, failures = agent_triage.close_selected(
                ["p-old", "p-now-working"], 100, now=1000)
        self.assertEqual(closed, ["p-old"])
        self.assertEqual(skipped, ["p-now-working"])
        self.assertEqual(failures, [])
        call.assert_called_once_with("pane.close", {"pane_id": "p-old"})

    def test_idle_and_prune_keybindings_are_reversible(self):
        import config_patch as cp
        import main
        import state
        self.write_config("no_sidebar")
        with mock.patch.object(main, "_reload_config"):
            self.assertEqual(main.cmd_idle_keybind_install([]), 0)
            self.assertEqual(main.cmd_prune_keybind_install([]), 0)
            doc = cp.load_doc()
            self.assertEqual(cp.keybind_key(doc, main.IDLE_NEXT_COMMAND), "prefix+.")
            self.assertEqual(cp.keybind_key(doc, main.PRUNE_COMMAND), "prefix+alt+x")
            self.assertEqual(main.cmd_idle_keybind_remove([]), 0)
            self.assertEqual(main.cmd_prune_keybind_remove([]), 0)
        doc = cp.load_doc()
        self.assertIsNone(cp.keybind_key(doc, main.IDLE_NEXT_COMMAND))
        self.assertIsNone(cp.keybind_key(doc, main.PRUNE_COMMAND))
        self.assertFalse(state.load()["idle_keybind_installed"])
        self.assertFalse(state.load()["prune_keybind_installed"])


if __name__ == "__main__":
    unittest.main()
