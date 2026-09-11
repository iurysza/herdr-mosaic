"""Public naming contracts, using isolated state and stubbed Herdr I/O."""

import io
import os
import re
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from test_plugin import Base


ALIASES = {
    'pick-color': ('set-identity',),
    'set-color': ('apply-identity',),
    'list-colors': ('list',),
    'assign-colors': ('auto-assign',),
    'tint-intensity': ('intensity',),
    'tint-preview': ('preview',),
    'agents': ('view',),
    'agent-board': ('board-open',),
    'arrange-columns': ('layout', 'equalize'),
    'next-layout': ('layout', 'cycle'),
}


class TestPublicManifest(unittest.TestCase):
    def test_existing_ids_and_new_controls_are_supported_without_alias_actions(self):
        # Frozen public action contract, including advanced and recovery actions.
        workspace = ['global', 'workspace']
        expected = {
            'set-identity': ('set-identity', ['workspace', 'pane']),
            'auto-assign': ('auto-assign', workspace),
            'tint-enable': ('tint-enable', workspace),
            'tint-disable': ('tint-disable', workspace),
            'theme-restore': ('theme-restore', workspace),
            'toggle-agent-focus': ('toggle-agent-focus', workspace),
            'toggle-agent-sort': ('toggle-agent-sort', workspace),
            'show-all-agents': ('view all', workspace),
            'show-current-space-agents': ('view current', workspace),
            'open-agent-board': ('board-open', workspace),
            'install': ('install', workspace),
            'migrate': ('migrate', workspace),
            'equalize': ('layout equalize', ['tab', 'pane']),
            'cycle': ('layout cycle', ['tab', 'pane']),
            'preview-tint': ('preview', workspace),
            'bind-picker-key': ('keybind-install', workspace),
            'unbind-picker-key': ('keybind-remove', workspace),
            'doctor': ('doctor', workspace),
            'uninstall': ('uninstall', workspace),
        }
        for direction in ('left', 'right', 'up', 'down'):
            name = 'resize-' + direction
            expected[name] = ('layout ' + name, ['pane'])
        for intensity in ('subtle', 'medium', 'bold'):
            expected['intensity-' + intensity] = ('intensity ' + intensity, workspace)
        # The manifest has 26 actions. Derive the count from this contract,
        # rather than treating prose counts as a source of truth.
        text = (Path(__file__).resolve().parents[1] / 'herdr-plugin.toml').read_text()
        blocks = text.split('[[actions]]')[1:]
        ids = [re.search(r'^id = "([^"]+)"', block, re.M).group(1) for block in blocks]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(set(ids), set(expected))
        for action, block in zip(ids, blocks):
            with self.subTest(action=action):
                command, contexts = expected[action]
                self.assertIn('src/main.py\\" ' + command + '"]', block)
                self.assertIn('contexts = [' + ', '.join('"%s"' % c for c in contexts) + ']', block)
                self.assertRegex(block, r'title = "Mosaic: [^"]+"')
                self.assertNotRegex(block, r'(?m)^(hidden|group|aliases|submenu)\s*=')


class TestPublicCLI(Base):
    def test_aliases_dispatch_existing_commands_with_arguments_and_exit_codes(self):
        import main
        for alias, target in ALIASES.items():
            for code in (0, 1):
                with self.subTest(alias=alias, code=code):
                    handler = mock.Mock(return_value=code)
                    with mock.patch.dict(main.COMMANDS, {target[0]: handler}), \
                            mock.patch('sidebar.publish_once') as publish, \
                            mock.patch('refresh.start') as start:
                        self.assertEqual(main.main([alias, '--example', 'value']), code)
                    handler.assert_called_once_with(list(target[1:]) + ['--example', 'value'])
                    self.assertEqual(publish.called, code == 0 and alias == 'set-color')
                    self.assertEqual(start.called, publish.called)

    def test_help_never_dispatches_or_checks_live_state(self):
        import main
        names = list(main.COMMANDS) + list(ALIASES)
        for args in ([], ['--help']) + tuple([name, '--help'] for name in names):
            with self.subTest(args=args):
                output = io.StringIO()
                with mock.patch('migrate.window_manager_pending') as pending, \
                        mock.patch('rpc.call') as rpc, \
                        redirect_stdout(output):
                    self.assertEqual(main.main(args), 0)
                pending.assert_not_called()
                rpc.assert_not_called()
                for section in ('Space color:', 'Tint:', 'Agent view:', 'Pane layouts:',
                                'Advanced setup and maintenance:', 'Internal hooks and recovery:'):
                    self.assertIn(section, output.getvalue())
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main.main(['set-color', '-h']), 0)

    def test_aliases_keep_registration_and_pending_import_guards(self):
        import main
        for alias, target in ALIASES.items():
            with self.subTest(alias=alias):
                handler = mock.Mock()
                with mock.patch.dict(main.COMMANDS, {target[0]: handler}), \
                        mock.patch.dict(os.environ, {'HERDR_PLUGIN_ID': 'another.plugin'}), \
                        redirect_stderr(io.StringIO()):
                    self.assertEqual(main.main([alias]), 1)
                handler.assert_not_called()
                with mock.patch.dict(main.COMMANDS, {target[0]: handler}), \
                        mock.patch('migrate.window_manager_pending', return_value=True), \
                        redirect_stderr(io.StringIO()):
                    self.assertEqual(main.main([alias]), 1)
                handler.assert_not_called()

    def test_exact_color_alias_saves_and_publishes_like_existing_setter(self):
        import main
        import state
        calls = []
        workspace = {'workspace_id': 'w1', 'label': 'Website', 'focused': True}
        agent = {'pane_id': 'w1:p1', 'workspace_id': 'w1', 'tab_id': 'w1:t1'}

        def call(method, params=None, **kwargs):
            calls.append((method, params))
            if method == 'workspace.list':
                return {'workspaces': [workspace]}
            if method == 'agent.list':
                return {'agents': [agent]}
            if method == 'tab.list':
                return {'tabs': [{'tab_id': 'w1:t1', 'label': 'Task'}]}
            return {}

        st = state.default_state()
        st['sidebar_installed'] = True
        state.save(st)
        results = []
        # Both flag spellings remain valid. The alias must publish sidebar titles
        # after the setter, rather than merely reaching the same handler.
        for command, flag in (('set-color', '--color'), ('apply-identity', '--colour')):
            calls[:] = []
            output = io.StringIO()
            with mock.patch('rpc.call', side_effect=call), \
                    mock.patch('refresh.start') as start, redirect_stdout(output):
                self.assertEqual(main.main([command, '--workspace', 'w1', flag, '#ABC']), 0)
            start.assert_called_once_with()
            self.assertEqual(state.load()['identities']['w1'],
                             {'colour': '#aabbcc', 'origin': 'manual'})
            self.assertTrue(any(params.get('source') == 'agent-sidebar-title'
                                for method, params in calls if method == 'pane.report_metadata'))
            results.append((output.getvalue(), list(calls)))
        self.assertEqual(results[0], results[1])

    def test_invalid_color_does_not_save_or_start_refresh(self):
        import main
        import state
        before = state.load()
        with mock.patch('rpc.call') as rpc, mock.patch('refresh.start') as start, \
                redirect_stderr(io.StringIO()):
            self.assertEqual(main.main(['set-color', '--workspace', 'w1', '--color', 'invalid']), 1)
        self.assertEqual(state.load(), before)
        rpc.assert_not_called()
        start.assert_not_called()
