"""Pane move action and confirmation contracts."""

import os
import unittest
from unittest import mock

from test_plugin import Base


class TestPaneMove(Base):
    @staticmethod
    def panes():
        return [
            {
                "pane_id": "w1:p1",
                "workspace_id": "w1",
                "tab_id": "w1:t1",
                "terminal_title_stripped": "Source",
            },
            {
                "pane_id": "w2:p2",
                "workspace_id": "w2",
                "tab_id": "w2:t2",
                "terminal_title_stripped": "Destination",
            },
        ]

    def test_explicit_placement_keys_do_not_depend_on_enter_variants(self):
        import pane_move
        self.assertEqual(pane_move.placement_for_key(ord("s")), "split")
        self.assertEqual(pane_move.placement_for_key(ord("S")), "split")
        self.assertEqual(pane_move.placement_for_key(ord("t")), "tab")
        self.assertEqual(pane_move.placement_for_key(ord("T")), "tab")
        self.assertIsNone(pane_move.placement_for_key(ord("\n")))
        self.assertIsNone(pane_move.placement_for_key(ord("\r")))

    def test_first_invocation_captures_source_and_notifies_quietly(self):
        import main
        import state
        calls = []

        def try_call(method, params=None, **kw):
            calls.append((method, params))
            return {}, None

        with mock.patch.dict(os.environ, {"HERDR_PANE_ID": "w1:p1"}), \
                mock.patch("rpc.panes", return_value=self.panes()), \
                mock.patch("rpc.try_call", side_effect=try_call):
            self.assertEqual(main.cmd_move_pane([]), 0)

        self.assertEqual(state.load()["pending_pane_move"], {"pane_id": "w1:p1"})
        self.assertEqual(calls, [("notification.show", {
            "title": "Mosaic",
            "body": "Pane selected. Navigate, then press prefix+/ again.",
            "sound": "none",
        })])

    def test_second_invocation_opens_confirmation_for_captured_source(self):
        import main
        import state
        selected = state.default_state()
        selected["pending_pane_move"] = {"pane_id": "w1:p1"}
        state.save(selected)
        calls = []

        def try_call(method, params=None, **kw):
            calls.append((method, params))
            return {}, None

        with mock.patch.dict(os.environ, {"HERDR_PANE_ID": "w2:p2"}), \
                mock.patch("rpc.panes", return_value=self.panes()), \
                mock.patch("rpc.try_call", side_effect=try_call):
            self.assertEqual(main.cmd_move_pane([]), 0)

        self.assertEqual(calls, [("plugin.pane.open", {
            "plugin_id": "iurysza.mosaic",
            "entrypoint": "pane-move",
            "focus": True,
            "placement": "popup",
            "env": {
                "MOSAIC_PANE_MOVE_SOURCE": "w1:p1",
                "MOSAIC_PANE_MOVE_DESTINATION": "w2:p2",
            },
        })])
        self.assertEqual(state.load()["pending_pane_move"], {"pane_id": "w1:p1"})

    def test_missing_source_clears_stale_selection(self):
        import main
        import state
        selected = state.default_state()
        selected["pending_pane_move"] = {"pane_id": "gone"}
        state.save(selected)
        notices = []

        with mock.patch.dict(os.environ, {"HERDR_PANE_ID": "w2:p2"}), \
                mock.patch("rpc.panes", return_value=[self.panes()[1]]), \
                mock.patch("rpc.try_call", side_effect=lambda *args, **kw: (
                    notices.append(args), ({}, None))[1]):
            self.assertEqual(main.cmd_move_pane([]), 0)

        self.assertIsNone(state.load()["pending_pane_move"])
        self.assertEqual(notices[0][0], "notification.show")

    def test_confirmed_split_moves_right_of_destination_and_clears_selection(self):
        import ctx
        import pane_move
        import state
        selected = state.default_state()
        selected["pending_pane_move"] = {"pane_id": "w1:p1"}
        state.save(selected)
        calls = []

        def call(method, params=None, **kw):
            calls.append((method, params))
            self.assertEqual(method, "pane.move")
            return {"move_result": {"changed": True}}

        with mock.patch("rpc.panes", return_value=self.panes()), \
                mock.patch("rpc.call", side_effect=call), ctx.Lock():
            self.assertEqual(pane_move.move("w1:p1", "w2:p2", "split"), "moved")

        self.assertEqual(calls[0][1], {
            "pane_id": "w1:p1",
            "destination": {
                "type": "tab",
                "tab_id": "w2:t2",
                "target_pane_id": "w2:p2",
                "split": "right",
                "ratio": 0.5,
            },
            "focus": True,
        })
        self.assertIsNone(state.load()["pending_pane_move"])

    def test_same_pane_refuses_split_but_allows_new_tab(self):
        import ctx
        import pane_move
        import state
        selected = state.default_state()
        selected["pending_pane_move"] = {"pane_id": "w1:p1"}
        state.save(selected)
        calls = []

        def call(method, params=None, **kw):
            calls.append((method, params))
            return {"move_result": {"changed": True}}

        with mock.patch("rpc.panes", return_value=self.panes()), ctx.Lock():
            self.assertEqual(pane_move.move("w1:p1", "w1:p1", "split"), "same_pane")
        self.assertEqual(state.load()["pending_pane_move"], {"pane_id": "w1:p1"})

        with mock.patch("rpc.panes", return_value=self.panes()), \
                mock.patch("rpc.call", side_effect=call), ctx.Lock():
            self.assertEqual(pane_move.move("w1:p1", "w1:p1", "tab"), "moved")

        self.assertEqual(calls[0][1]["destination"], {
            "type": "new_tab",
            "workspace_id": "w1",
        })
        self.assertIsNone(state.load()["pending_pane_move"])

    def test_rejected_confirmation_keeps_selection_for_retry_or_cancel(self):
        import pane_move
        import state
        selected = state.default_state()
        selected["pending_pane_move"] = {"pane_id": "w1:p1"}
        state.save(selected)
        popup = pane_move.PaneMovePopup.__new__(pane_move.PaneMovePopup)
        popup.source_id = "w1:p1"
        popup.destination_id = "w2:p2"
        popup.notice = ""

        with mock.patch("pane_move.move", side_effect=pane_move.PaneMoveError("rejected")):
            self.assertFalse(popup.place("split"))

        self.assertEqual(popup.notice, "Move failed: rejected")
        self.assertEqual(state.load()["pending_pane_move"], {"pane_id": "w1:p1"})

    def test_fast_promote_moves_focused_pane_without_touching_selection(self):
        import main
        import state
        selected = state.default_state()
        selected["pending_pane_move"] = {"pane_id": "w2:p2"}
        state.save(selected)
        calls = []

        def call(method, params=None, **kw):
            calls.append((method, params))
            return {"move_result": {"changed": True}}

        with mock.patch.dict(os.environ, {"HERDR_PANE_ID": "w1:p1"}), \
                mock.patch("rpc.panes", return_value=self.panes()), \
                mock.patch("rpc.call", side_effect=call):
            self.assertEqual(main.cmd_promote_pane([]), 0)

        self.assertEqual(calls[0][1]["destination"], {
            "type": "new_tab",
            "workspace_id": "w1",
        })
        self.assertEqual(state.load()["pending_pane_move"], {"pane_id": "w2:p2"})

    def test_pane_move_and_promote_shortcuts_are_reversible(self):
        import config_patch as cp
        import main
        import state
        self.write_config("no_sidebar")
        with mock.patch.object(main, "_reload_config"):
            self.assertEqual(main.cmd_pane_move_keybind_install([]), 0)
            self.assertEqual(main.cmd_promote_pane_keybind_install([]), 0)
            doc = cp.load_doc()
            self.assertEqual(cp.keybind_key(doc, main.PANE_MOVE_COMMAND), "prefix+/")
            self.assertEqual(cp.keybind_key(doc, main.PROMOTE_PANE_COMMAND), "prefix+shift+m")
            self.assertEqual(main.cmd_pane_move_keybind_remove([]), 0)
            self.assertEqual(main.cmd_promote_pane_keybind_remove([]), 0)
        doc = cp.load_doc()
        self.assertIsNone(cp.keybind_key(doc, main.PANE_MOVE_COMMAND))
        self.assertIsNone(cp.keybind_key(doc, main.PROMOTE_PANE_COMMAND))
        self.assertFalse(state.load()["pane_move_keybind_installed"])
        self.assertFalse(state.load()["promote_pane_keybind_installed"])

    def test_occupied_shortcut_is_not_replaced_or_claimed(self):
        import main
        import state
        path = self.write_config("no_sidebar")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n[[keys.command]]\nkey = \"prefix+/\"\n"
                     "type = \"shell\"\ncommand = \"my-command\"\n")
        with open(path, encoding="utf-8") as fh:
            before = fh.read()
        with mock.patch.object(main, "_reload_config"):
            self.assertEqual(main.cmd_pane_move_keybind_install([]), 0)
        with open(path, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), before)
        self.assertFalse(state.load()["pane_move_keybind_installed"])


if __name__ == "__main__":
    unittest.main()
