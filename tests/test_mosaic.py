"""Mosaic rename regressions, isolated from the installed Window Manager."""

import io
import json
import os
import re
import unittest
from pathlib import Path
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from test_plugin import Base


class TestMosaicMigration(Base):
    def setUp(self):
        super().setUp()
        import migrate
        self.old_state = migrate.window_manager_state_dir()
        self.old_config = migrate.window_manager_config_dir()
        os.makedirs(self.old_state)
        os.makedirs(self.old_config)
        self.write_config('users_real')

    def write(self, directory, name, text):
        path = os.path.join(directory, name)
        with open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(text)
        return path

    def read(self, path):
        with open(path, 'r', encoding='utf-8', newline='') as fh:
            return fh.read()

    def seed(self, **changes):
        import state
        st = state.default_state()
        st.update(changes)
        text = json.dumps(st, indent=4) + '\n'
        self.write(self.old_state, 'state.json', text)
        return text

    def migrate(self, args=None):
        import main
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return main.main(['migrate'] + (args or []))

    def test_import_preserves_state_settings_rules_and_backups_byte_exactly(self):
        import ctx
        original = self.seed(
            identities={'w1': {'colour': '#7aa2f7', 'origin': 'manual'}},
            agent_settled={'w1:p1': {'status': 'idle', 'last_settled_at': 123}},
            view_mode='current',
            theme_backup={'keys': {'ui.accent': {'present': False}}},
            future_field={'keep': True},
        )
        files = {
            'settings.json': '{\r\n  "intensity": "bold", "marker": "◆"\r\n}\r\n',
            'identities.json': '{"version": 1, "identities": {"API": "sage"}}\n',
            'legacy-layouts-settings.json': '{"keep": true}\n',
        }
        for name, text in files.items():
            self.write(self.old_config, name, text)
        snapshot = '# before Window Manager\r\n[theme]\r\nname = "gruvbox"\r\n'
        name = 'config.backup.20260908-004032.toml'
        self.write(self.old_state, name, snapshot)
        before_config = self.read(ctx.herdr_config_path())
        self.assertEqual(self.migrate(), 0)
        self.assertEqual(self.read(os.path.join(ctx.state_dir(), 'state.json')), original)
        self.assertEqual(self.read(os.path.join(self.old_state, 'state.json')), original)
        self.assertEqual(self.read(os.path.join(ctx.state_dir(), name)), snapshot)
        self.assertEqual(self.read(ctx.herdr_config_path()), before_config)
        for name, text in files.items():
            self.assertEqual(self.read(os.path.join(ctx.config_dir(), name)), text)
            self.assertEqual(self.read(os.path.join(self.old_config, name)), text)

    def test_existing_mosaic_state_wins_on_repeat_even_with_force(self):
        import ctx
        import state
        self.seed(view_mode='current')
        self.assertEqual(self.migrate(), 0)
        with ctx.Lock():
            current = state.load()
            current['view_mode'] = 'all'
            state.save(current)
        before = self.read(os.path.join(ctx.state_dir(), 'state.json'))
        self.seed(view_mode='current', tint_enabled=True)
        self.assertEqual(self.migrate(['--force']), 0)
        self.assertEqual(self.read(os.path.join(ctx.state_dir(), 'state.json')), before)

    def test_chromatic_cannot_override_window_manager_on_import_or_repeat(self):
        import state
        self.seed(identities={'w1': {'colour': '#7aa2f7', 'origin': 'manual'}})
        directory = os.environ['HERDR_LEGACY_CHROMATIC_STATE_DIR']
        os.makedirs(directory)
        self.write(directory, 'state.json', json.dumps({
            'identities': {'w1': {'colour': '#a6d189', 'origin': 'manual'}},
            'sidebar_backup': {'keys': {'ui.sidebar.agents.rows': {'present': False}}},
        }))
        self.assertEqual(self.migrate(), 0)
        self.assertEqual(self.migrate(['--force']), 0)
        self.assertEqual(state.load()['identities']['w1']['colour'], '#7aa2f7')
        self.assertIsNone(state.load()['sidebar_backup'])

    def test_legacy_cleanup_does_not_reenable_chromatic_import(self):
        import state
        self.seed(identities={'w1': {'colour': '#7aa2f7', 'origin': 'manual'}})
        self.assertEqual(self.migrate(), 0)
        os.remove(os.path.join(self.old_state, 'state.json'))
        directory = os.environ['HERDR_LEGACY_CHROMATIC_STATE_DIR']
        os.makedirs(directory)
        self.write(directory, 'state.json', json.dumps({
            'identities': {'w1': {'colour': '#a6d189', 'origin': 'manual'}},
        }))
        self.assertEqual(self.migrate(['--force']), 0)
        self.assertEqual(state.load()['identities']['w1']['colour'], '#7aa2f7')

    def test_failed_final_state_write_can_be_retried(self):
        import ctx
        self.seed()
        self.write(self.old_config, 'settings.json', '{"intensity": "bold"}\n')
        target = os.path.join(ctx.state_dir(), 'state.json')
        write = ctx.atomic_write

        def fail_state(path, text):
            if path == target:
                raise OSError('test interrupted state commit')
            write(path, text)

        with mock.patch('ctx.atomic_write', side_effect=fail_state):
            self.assertEqual(self.migrate(), 1)
        self.assertFalse(os.path.exists(target))
        self.assertEqual(self.migrate(), 0)
        self.assertTrue(os.path.exists(target))

    def test_dry_run_does_not_copy_data_or_change_config(self):
        import ctx
        self.seed()
        self.write(self.old_config, 'settings.json', '{"intensity": "bold"}\n')
        before = self.read(ctx.herdr_config_path())
        self.assertEqual(self.migrate(['--dry-run']), 0)
        self.assertFalse(os.path.exists(os.path.join(ctx.state_dir(), 'state.json')))
        self.assertFalse(os.path.exists(ctx.settings_path()))
        self.assertEqual(self.read(ctx.herdr_config_path()), before)

    def test_install_dry_run_never_starts_refresh_for_existing_install(self):
        import ctx
        import main
        import state
        self.seed()
        self.assertEqual(self.migrate(), 0)
        with ctx.Lock():
            st = state.load()
            st['sidebar_installed'] = True
            state.save(st)
        with mock.patch('sidebar.publish_once') as publish, \
                mock.patch('refresh.start') as start, redirect_stdout(io.StringIO()):
            self.assertEqual(main.main(['install', '--dry-run']), 0)
        publish.assert_not_called()
        start.assert_not_called()

    def test_conflicting_files_fail_before_any_copy_even_with_force(self):
        import ctx
        self.seed()
        self.write(self.old_config, 'settings.json', '{"intensity": "bold"}\n')
        self.write(self.old_config, 'identities.json', '{"version": 1}\n')
        conflict = self.write(ctx.config_dir(), 'identities.json', '{"version": 2}\n')
        self.assertEqual(self.migrate(['--force']), 1)
        self.assertFalse(os.path.exists(ctx.settings_path()))
        self.assertFalse(os.path.exists(os.path.join(ctx.state_dir(), 'state.json')))
        self.assertEqual(self.read(conflict), '{"version": 2}\n')

    def test_equal_files_allow_retry_after_interrupted_copy(self):
        import ctx
        self.seed()
        text = '{"marker": "◆"}\n'
        self.write(self.old_config, 'settings.json', text)
        self.write(ctx.config_dir(), 'settings.json', text)
        self.assertEqual(self.migrate(), 0)
        self.assertEqual(self.read(ctx.settings_path()), text)

    def test_unreadable_or_unsupported_source_does_not_create_state(self):
        import ctx
        for text in ('not json', '[]', 'null', '{"version": 999}'):
            with self.subTest(text=text):
                self.write(self.old_state, 'state.json', text)
                self.assertEqual(self.migrate(), 1)
                self.assertFalse(os.path.exists(os.path.join(ctx.state_dir(), 'state.json')))

    def test_startup_and_events_wait_for_explicit_migration(self):
        import ctx
        import main
        self.seed()
        for args in (['reconcile'], ['event', 'workspace.focused'], ['uninstall']):
            with self.subTest(args=args), redirect_stderr(io.StringIO()) as output:
                self.assertEqual(main.main(args), 1)
                self.assertIn('awaits import', output.getvalue())
        self.assertFalse(os.path.exists(os.path.join(ctx.state_dir(), 'state.json')))

    def test_old_registry_identity_cannot_run_new_checkout(self):
        import main
        with mock.patch.dict(os.environ, {'HERDR_PLUGIN_ID': 'iurysza.window-manager'}):
            with redirect_stderr(io.StringIO()) as output:
                self.assertEqual(main.main(['install']), 1)
        self.assertIn('cannot run as iurysza.window-manager', output.getvalue())

    def test_migrated_restore_records_restore_original_config_byte_exactly(self):
        import config_patch as cp
        import ctx
        import main
        import state
        original = self.read(ctx.herdr_config_path())
        doc = cp.load_doc()
        backup, _ = cp.install_sidebar(doc)
        self.seed(sidebar_installed=True, sidebar_backup=backup,
                  ownership_baseline=backup,
                  last_written={'.'.join(key): doc.get(key)
                                for key in (cp.SPACES_ROWS, cp.AGENTS_ROWS)})
        with ctx.Lock():
            cp.commit(doc)
        self.assertEqual(self.migrate(), 0)
        with mock.patch('rpc.workspaces', return_value=[]), \
                mock.patch('rpc.agents', return_value=[]), \
                mock.patch('rpc.try_call', return_value=({}, None)), \
                redirect_stdout(io.StringIO()):
            self.assertEqual(main.main(['uninstall']), 0)
        self.assertEqual(self.read(ctx.herdr_config_path()), original)
        self.assertIsNone(state.load()['sidebar_backup'])

    @mock.patch('sidebar.publish_once')
    @mock.patch('refresh.start')
    def test_restore_import_install_uninstall_lifecycle(self, start_refresh, publish_sidebar):
        import config_patch as cp
        import ctx
        import main
        import state
        original = self.read(ctx.herdr_config_path())
        with mock.patch('rpc.workspaces', return_value=[]), \
                mock.patch('rpc.agents', return_value=[]), \
                mock.patch('rpc.try_call', return_value=({}, None)), \
                redirect_stdout(io.StringIO()):
            with mock.patch.dict(os.environ, {
                'HERDR_PLUGIN_STATE_DIR': self.old_state,
                'HERDR_PLUGIN_CONFIG_DIR': self.old_config,
            }), mock.patch.object(main, 'PICKER_COMMAND',
                                  'iurysza.window-manager.set-identity'):
                self.assertEqual(main.cmd_sidebar_install([]), 0)
                self.assertEqual(main.cmd_keybind_install([]), 0)
                self.assertEqual(main.cmd_uninstall([]), 0)
            self.assertEqual(self.read(ctx.herdr_config_path()), original)
            self.assertEqual(self.migrate(), 0)
            self.assertEqual(main.main(['install']), 0)
            self.assertEqual(cp.keybind_key(cp.load_doc(), 'iurysza.mosaic.set-identity'),
                             'prefix+i')
            self.assertEqual(main.main(['uninstall']), 0)
        self.assertEqual(self.read(ctx.herdr_config_path()), original)
        self.assertIsNone(state.load()['sidebar_backup'])

    def test_new_identity_reaches_metadata_and_agent_view(self):
        import agent_view
        import ctx
        import metadata
        self.assertEqual(ctx.PLUGIN_NAME, 'Mosaic')
        self.assertEqual(agent_view.definition()['source'], 'iurysza.mosaic')
        with mock.patch('rpc.try_call', return_value=({}, None)) as call:
            metadata.publish_workspace('w1', '#7aa2f7')
        self.assertEqual(call.call_args[0][1]['source'], 'iurysza.mosaic')


class TestActionMigration(Base):
    def binding(self, key='ctrl+backslash', action='equalize'):
        return ('# user binding\n[[keys.command]]\nkey = "%s"\ntype = "plugin_action"\n'
                'command = \'iurysza.window-manager.%s\'  # keep comment\n'
                'description = "My layout"\n' % (key, action))

    def test_roundtrip_keeps_comments_and_quote_style(self):
        import config_patch as cp
        from toml_edit import TomlDoc
        original = self.binding() + '\n' + self.binding('prefix+space')
        doc = TomlDoc(original)
        records = cp.rename_plugin_actions(doc, 'iurysza.window-manager', 'iurysza.mosaic')
        self.assertEqual(len(records), 2)
        self.assertIn('iurysza.mosaic.equalize', doc.dumps())
        self.assertEqual(cp.rename_plugin_actions(doc, 'iurysza.window-manager', 'iurysza.mosaic'), [])
        self.assertEqual(cp.restore_action_renames(doc, records), [])
        self.assertEqual(doc.dumps(), original)

    def test_unapplied_records_do_not_report_a_user_conflict(self):
        import config_patch as cp
        from toml_edit import TomlDoc
        original = self.binding()
        candidate = TomlDoc(original)
        records = cp.rename_plugin_actions(candidate, 'iurysza.window-manager', 'iurysza.mosaic')
        unchanged = TomlDoc(original)
        self.assertEqual(cp.restore_action_renames(unchanged, records), [])
        self.assertEqual(unchanged.dumps(), original)

    def test_manual_edit_is_not_overwritten_during_restore(self):
        import config_patch as cp
        from toml_edit import TomlDoc
        doc = TomlDoc(self.binding())
        records = cp.rename_plugin_actions(doc, 'iurysza.window-manager', 'iurysza.mosaic')
        sec = cp.find_keybind(doc, 'iurysza.mosaic.equalize')
        doc.set_section_scalar(sec, 'description', 'Changed by user')
        before = doc.dumps()
        self.assertEqual(cp.restore_action_renames(doc, records), records)
        self.assertEqual(doc.dumps(), before)

    @mock.patch('sidebar.publish_once')
    @mock.patch('refresh.start')
    def test_install_uninstall_restores_user_action_bindings(self, start, publish):
        import config_patch as cp
        import ctx
        import main
        import state
        original = '[theme]\nname = "gruvbox"\n\n' + self.binding() + '\n' + self.binding('prefix+i', 'set-identity')
        path = ctx.herdr_config_path()
        with open(path, 'w') as fh:
            fh.write(original)
        with mock.patch('rpc.workspaces', return_value=[]), \
                mock.patch('rpc.agents', return_value=[]), \
                mock.patch('rpc.try_call', return_value=({}, None)), \
                redirect_stdout(io.StringIO()):
            self.assertEqual(main.main(['install']), 0)
            self.assertEqual(cp.keybind_key(cp.load_doc(), 'iurysza.mosaic.equalize'), 'ctrl+backslash')
            self.assertEqual(cp.keybind_key(cp.load_doc(), 'iurysza.mosaic.set-identity'), 'prefix+i')
            self.assertEqual(main.main(['uninstall']), 0)
        with open(path) as fh:
            self.assertEqual(fh.read(), original)
        self.assertEqual(state.load()['action_renames'], [])


class TestMosaicDocs(unittest.TestCase):
    ROOT = Path(__file__).resolve().parents[1]

    def documents(self):
        return [self.ROOT / 'README.md'] + list((self.ROOT / 'docs').glob('*.md'))

    def test_local_documentation_links_exist(self):
        for path in self.documents():
            for link in re.findall(r'\]\(([^)]+)\)', path.read_text()):
                if '://' in link or link.startswith('#'):
                    continue
                target = link.split('#', 1)[0]
                with self.subTest(document=path.name, link=link):
                    self.assertTrue((path.parent / target).exists())

    def test_public_product_docs_do_not_advertise_internal_rollout(self):
        paths = ['README.md', 'docs/actions.md', 'docs/settings.md',
                 'docs/config-safety.md', 'docs/releases.md']
        for name in paths:
            with self.subTest(document=name):
                text = (self.ROOT / name).read_text()
                self.assertNotRegex(text, r'(?i)Window Manager|Chromatic|migration guide|ai-artifacts|dotfiles|toolbox')
                self.assertNotRegex(text, r'(?i)colour|recognise')
        self.assertIn('experimental', (self.ROOT / 'README.md').read_text())

    def test_documented_mosaic_invocations_exist_in_manifest(self):
        manifest = (self.ROOT / 'herdr-plugin.toml').read_text()
        actions = set(re.findall(r'^id = "([^"]+)"', manifest, re.M))
        for path in self.documents():
            invocations = re.findall(
                r'herdr plugin action invoke iurysza\.mosaic\.([a-z-]+)', path.read_text())
            for action in invocations:
                with self.subTest(document=path.name, action=action):
                    self.assertIn(action, actions)
