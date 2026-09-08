"""Native last-settled tracking. Isolated HOME/config/state/socket only."""

import json
import os
import time
import unittest

from test_plugin import Base


STATUSES = ("idle", "working", "blocked", "done", "unknown")
SETTLED = ("idle", "done")


class SettledBase(Base):
    EXTRA_ENV = (
        "HOME", "HERDR_PLUGIN_EVENT", "HERDR_PLUGIN_EVENT_JSON",
        "HERDR_PLUGIN_CONTEXT_JSON",
    )

    def setUp(self):
        super(SettledBase, self).setUp()
        self._extra_env = {k: os.environ.get(k) for k in self.EXTRA_ENV}
        os.environ["HOME"] = self.tmp
        os.environ.pop("HERDR_PLUGIN_EVENT", None)
        os.environ.pop("HERDR_PLUGIN_EVENT_JSON", None)
        os.environ.pop("HERDR_PLUGIN_CONTEXT_JSON", None)
        self.write_config("empty")

    def tearDown(self):
        for k, v in self._extra_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        super(SettledBase, self).tearDown()

    def _forbid_rpc(self):
        import rpc

        def boom(method, params=None, **kw):
            self.fail("unexpected rpc %s" % method)

        rpc.call = boom
        rpc.try_call = boom

    def _seed_unrelated(self):
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, "w1", "#4f8cff", origin="manual")
        st["tint_enabled"] = True
        st["last_written"] = {"theme.custom.accent": "#4f8cff"}
        st["view_installed"] = True
        st_mod.save(st)
        return st

    def _fire(self, name, payload, now=None):
        import main as main_mod
        os.environ["HERDR_PLUGIN_EVENT"] = name
        os.environ["HERDR_PLUGIN_EVENT_JSON"] = json.dumps(payload)
        if now is not None:
            real = time.time
            time.time = lambda: float(now)
            try:
                return main_mod.cmd_event([name])
            finally:
                time.time = real
        return main_mod.cmd_event([name])

    def _direct(self, pane_id, status, **extra):
        data = {
            "type": "pane_agent_status_changed",
            "pane_id": pane_id,
            "workspace_id": "w1",
            "agent_status": status,
        }
        data.update(extra)
        return data

    def _envelope(self, pane_id, status, **extra):
        return {
            "event": "pane_agent_status_changed",
            "data": self._direct(pane_id, status, **extra),
        }


class TestTransition(SettledBase):
    def test_all_five_states_update_previous_status(self):
        import agent_tracker
        rec = None
        for status in STATUSES:
            rec = agent_tracker.transition(rec, status, 10)
            self.assertEqual(rec["status"], status)
            self.assertIsNone(rec["last_settled_at"])

    def test_working_to_idle_and_done_record_now(self):
        import agent_tracker
        working = agent_tracker.transition(None, "working", 1)
        idle = agent_tracker.transition(working, "idle", 50)
        self.assertEqual(idle, {"status": "idle", "last_settled_at": 50})
        done = agent_tracker.transition(working, "done", 60)
        self.assertEqual(done, {"status": "done", "last_settled_at": 60})

    def test_done_to_idle_does_not_reset(self):
        import agent_tracker
        rec = {"status": "done", "last_settled_at": 40}
        out = agent_tracker.transition(rec, "idle", 99)
        self.assertEqual(out["last_settled_at"], 40)
        self.assertEqual(out["status"], "idle")

    def test_duplicate_settled_does_not_reset(self):
        import agent_tracker
        rec = {"status": "idle", "last_settled_at": 40}
        self.assertEqual(agent_tracker.transition(rec, "idle", 99)["last_settled_at"], 40)
        rec = {"status": "done", "last_settled_at": 40}
        self.assertEqual(agent_tracker.transition(rec, "done", 99)["last_settled_at"], 40)

    def test_first_idle_or_done_does_not_invent_completion(self):
        import agent_tracker
        self.assertIsNone(agent_tracker.transition(None, "idle", 5)["last_settled_at"])
        self.assertIsNone(agent_tracker.transition(None, "done", 5)["last_settled_at"])
        self.assertIsNone(agent_tracker.transition({}, "idle", 5)["last_settled_at"])

    def test_blocked_is_not_completion(self):
        import agent_tracker
        working = agent_tracker.transition(None, "working", 1)
        blocked = agent_tracker.transition(working, "blocked", 2)
        self.assertIsNone(blocked["last_settled_at"])
        self.assertEqual(blocked["status"], "blocked")
        idle = agent_tracker.transition(blocked, "idle", 3)
        self.assertIsNone(idle["last_settled_at"])
        done = agent_tracker.transition(blocked, "done", 4)
        self.assertIsNone(done["last_settled_at"])

    def test_unknown_is_not_completion(self):
        import agent_tracker
        working = agent_tracker.transition(None, "working", 1)
        unknown = agent_tracker.transition(working, "unknown", 2)
        self.assertEqual(unknown["status"], "unknown")
        self.assertIsNone(unknown["last_settled_at"])
        self.assertIsNone(agent_tracker.transition(unknown, "idle", 3)["last_settled_at"])
        self.assertIsNone(agent_tracker.transition(unknown, "done", 4)["last_settled_at"])

    def test_working_blocked_idle_is_not_direct_working_to_idle(self):
        import agent_tracker
        rec = agent_tracker.transition(None, "working", 1)
        rec = agent_tracker.transition(rec, "blocked", 2)
        rec = agent_tracker.transition(rec, "idle", 3)
        self.assertEqual(rec, {"status": "idle", "last_settled_at": None})

    def test_blocked_working_idle_does_count(self):
        import agent_tracker
        rec = agent_tracker.transition(None, "blocked", 1)
        rec = agent_tracker.transition(rec, "working", 2)
        rec = agent_tracker.transition(rec, "idle", 9)
        self.assertEqual(rec["last_settled_at"], 9)

    def test_idle_done_is_not_a_new_settlement(self):
        import agent_tracker
        rec = {"status": "idle", "last_settled_at": 7}
        out = agent_tracker.transition(rec, "done", 20)
        self.assertEqual(out["last_settled_at"], 7)

    def test_new_working_keeps_previous_settled_until_next_completion(self):
        import agent_tracker
        rec = {"status": "idle", "last_settled_at": 7}
        working = agent_tracker.transition(rec, "working", 8)
        self.assertEqual(working["last_settled_at"], 7)
        nxt = agent_tracker.transition(working, "done", 12)
        self.assertEqual(nxt["last_settled_at"], 12)

    def test_does_not_mutate_previous_record(self):
        import agent_tracker
        rec = {"status": "working", "last_settled_at": None}
        agent_tracker.transition(rec, "idle", 3)
        self.assertEqual(rec, {"status": "working", "last_settled_at": None})


class TestEventAdapter(SettledBase):
    def test_direct_and_envelope_payloads(self):
        self._forbid_rpc()
        self._seed_unrelated()
        self.assertEqual(self._fire(
            "pane.agent_status_changed",
            self._direct("w1:p1", "working"), now=10), 0)
        self.assertEqual(self._fire(
            "pane.agent_status_changed",
            self._envelope("w1:p1", "idle"), now=20), 0)
        import state as st_mod
        rec = st_mod.load()["agent_settled"]["w1:p1"]
        self.assertEqual(rec, {"status": "idle", "last_settled_at": 20})

    def test_optional_themed_fields_are_ignored_not_written(self):
        self._forbid_rpc()
        payload = self._direct(
            "w1:p2", "working",
            agent="pi", display_agent="Pi", title="do not write",
            state_labels={"themed_model_tier": "high"})
        self.assertEqual(self._fire("pane.agent_status_changed", payload, now=1), 0)
        import state as st_mod
        rec = st_mod.load()["agent_settled"]["w1:p2"]
        self.assertEqual(set(rec), {"status", "last_settled_at"})
        self.assertNotIn("title", rec)
        self.assertNotIn("themed_model_tier", rec)
        self.assertNotIn("state_labels", rec)

    def test_malformed_inputs_write_nothing(self):
        self._forbid_rpc()
        self._seed_unrelated()
        import ctx
        import state as st_mod
        before = st_mod.load()
        before_dump = json.dumps(before, sort_keys=True)
        config_path = os.environ["HERDR_CONFIG_PATH"]
        with open(config_path, encoding="utf-8") as fh:
            config_before = fh.read()
        state_path = os.path.join(ctx.state_dir(), "state.json")
        mtime = os.path.getmtime(state_path)
        bad = [
            {},
            {"type": "pane_agent_status_changed"},
            {"pane_id": "", "agent_status": "idle"},
            {"pane_id": "w1:p1", "agent_status": "running"},
            {"pane_id": "w1:p1", "agent_status": None},
            {"pane_id": ["w1:p1"], "agent_status": "idle"},
            {"pane_id": "w1:p1"},
            "not-an-object",
            {"data": "nope"},
        ]
        for payload in bad:
            self.assertEqual(
                self._fire("pane.agent_status_changed", payload, now=99), 0, payload)
        self.assertEqual(json.dumps(st_mod.load(), sort_keys=True), before_dump)
        self.assertEqual(os.path.getmtime(state_path), mtime)
        with open(config_path, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), config_before)
        self.assertFalse(os.path.exists(os.path.join(
            os.environ["HERDR_PLUGIN_CONFIG_DIR"], "settings.json")))

    def test_persistence_and_no_unrelated_writes(self):
        self._forbid_rpc()
        self._seed_unrelated()
        import ctx
        config_path = os.environ["HERDR_CONFIG_PATH"]
        with open(config_path, encoding="utf-8") as fh:
            config_before = fh.read()
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "working"), now=10)
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "idle"), now=11)
        import state as st_mod
        st = st_mod.load()
        self.assertEqual(st["agent_settled"]["w1:p1"]["last_settled_at"], 11)
        self.assertEqual(st["identities"]["w1"]["colour"], "#4f8cff")
        self.assertTrue(st["tint_enabled"])
        self.assertEqual(st["last_written"], {"theme.custom.accent": "#4f8cff"})
        self.assertTrue(st["view_installed"])
        with open(config_path, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), config_before)
        self.assertFalse(os.path.exists(os.path.join(
            os.environ["HERDR_PLUGIN_CONFIG_DIR"], "settings.json")))
        with open(os.path.join(ctx.state_dir(), "state.json"), encoding="utf-8") as fh:
            disk = json.load(fh)
        self.assertEqual(disk["agent_settled"]["w1:p1"]["last_settled_at"], 11)

    def test_duplicate_settled_event_skips_reset_and_rewrite(self):
        self._forbid_rpc()
        self._seed_unrelated()
        import ctx
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "working"), now=10)
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "idle"), now=11)
        path = os.path.join(ctx.state_dir(), "state.json")
        mtime = os.path.getmtime(path)
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "idle"), now=99)
        import state as st_mod
        self.assertEqual(st_mod.load()["agent_settled"]["w1:p1"]["last_settled_at"], 11)
        self.assertEqual(os.path.getmtime(path), mtime)

    def test_close_and_exit_drop_occupancy(self):
        self._forbid_rpc()
        self._seed_unrelated()
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "working"), now=10)
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "idle"), now=11)
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p2", "working"), now=12)
        self.assertEqual(self._fire("pane.closed", {
            "type": "pane_closed", "pane_id": "w1:p1", "workspace_id": "w1",
        }), 0)
        import state as st_mod
        st = st_mod.load()
        self.assertNotIn("w1:p1", st["agent_settled"])
        self.assertIn("w1:p2", st["agent_settled"])
        self.assertEqual(self._fire("pane.exited", {
            "type": "pane_exited", "pane_id": "w1:p2", "workspace_id": "w1",
        }), 0)
        st = st_mod.load()
        self.assertEqual(st["agent_settled"], {})
        self.assertEqual(st["identities"]["w1"]["colour"], "#4f8cff")

    def test_reused_pane_id_does_not_inherit_settled(self):
        self._forbid_rpc()
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "working"), now=10)
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "idle"), now=11)
        self._fire("pane.closed", {
            "type": "pane_closed", "pane_id": "w1:p1", "workspace_id": "w1",
        })
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "idle"), now=12)
        import state as st_mod
        rec = st_mod.load()["agent_settled"]["w1:p1"]
        self.assertEqual(rec["status"], "idle")
        self.assertIsNone(rec["last_settled_at"])

    def test_close_without_record_does_not_write(self):
        self._forbid_rpc()
        self._seed_unrelated()
        import ctx
        path = os.path.join(ctx.state_dir(), "state.json")
        mtime = os.path.getmtime(path)
        self.assertEqual(self._fire("pane.closed", {
            "type": "pane_closed", "pane_id": "missing", "workspace_id": "w1",
        }), 0)
        self.assertEqual(os.path.getmtime(path), mtime)

    def test_adapter_takes_plugin_lock(self):
        self._forbid_rpc()
        import ctx
        held = []
        real = ctx.Lock

        class Spy(real):
            def __enter__(self):
                held.append(True)
                return real.__enter__(self)

        ctx.Lock = Spy
        self._fire("pane.agent_status_changed",
                   self._direct("w1:p1", "working"), now=1)
        self.assertTrue(held)

    def test_manifest_declares_new_hooks(self):
        root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
        with open(os.path.join(root, "herdr-plugin.toml"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn('on = "pane.agent_status_changed"', text)
        self.assertIn('on = "pane.closed"', text)
        self.assertIn('on = "pane.exited"', text)


if __name__ == "__main__":
    unittest.main()
