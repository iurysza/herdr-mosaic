"""Bundle regressions: sidebar caps, migration, labels, layouts dispatch, manifest."""

import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
sys.path.insert(0, os.path.join(ROOT, 'src'))

from test_plugin import Base, FIXTURES


LIVE_AGENTS = '''[ui.sidebar.agents]
rows = [[
  "state_icon",
  {token = "$elapsed", dim = true},
  {token = "$title_rose", fg = "#eba0ac", dim = false},
  {token = "$title_peach", fg = "#fab387", dim = false},
  {token = "$title_amber", fg = "#e5c07b", dim = false},
  {token = "$title_sage", fg = "#a6d189", dim = false},
  {token = "$title_aqua", fg = "#7fd6c1", dim = false},
  {token = "$title_cyan", fg = "#8be9fd", dim = false},
  {token = "$title_steel", fg = "#8ca0b3", dim = false},
  {token = "$title_azure", fg = "#7aa2f7", dim = false},
  {token = "$title_lavender", fg = "#b4befe", dim = false},
  {token = "$title_mauve", fg = "#cba6f7", dim = false},
  {token = "$title_orchid", fg = "#e0a3e8", dim = false},
  {token = "$title_blush", fg = "#f5c2e7", dim = false},
  {token = "$themed_model_tier", dim = true},
]]
'''


class TestUnifiedSidebar(Base):
    def test_agent_row_is_fifteen_tokens_without_space_dots(self):
        import config_patch as cp
        row = cp.agent_rows_template()[0]
        self.assertEqual(len(row), 15)
        self.assertFalse(cp.has_dots([row]))
        self.assertTrue(cp.has_title_tokens([row]))
        self.assertTrue(cp.row_has_token([row], '$elapsed'))
        self.assertTrue(cp.row_has_token([row], '$themed_model_tier'))
        cp._check_limits([row], 'agents')

    def test_agent_row_plus_twelve_dots_is_rejected(self):
        import config_patch as cp
        mixed = [cp.agent_rows_template()[0][:1]
                 + cp.dot_tokens()
                 + cp.agent_rows_template()[0][1:]]
        self.assertGreater(len(mixed[0]), 16)
        with self.assertRaises(cp.ConfigError) as caught:
            cp.refuse_agent_dots(mixed, 'ui.sidebar.agents.rows')
        msg = str(caught.exception)
        self.assertIn('15-token', msg)
        self.assertIn('max 16', msg)

    def test_live_agent_template_is_idempotent(self):
        import config_patch as cp
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(LIVE_AGENTS)
        os.environ['HERDR_CONFIG_PATH'] = path
        doc = cp.load_doc()
        first = doc.dumps()
        _backup, changes = cp.install_sidebar(doc)
        agent_changes = [c for c in changes if c[0] == 'ui.sidebar.agents.rows']
        self.assertEqual(agent_changes, [])
        self.assertTrue(cp.has_agent_template(doc.get(('ui', 'sidebar', 'agents', 'rows'))))
        _b2, changes2 = cp.install_sidebar(doc)
        self.assertEqual([c for c in changes2 if c[0] == 'ui.sidebar.agents.rows'], [])
        self.assertEqual(doc.get(('ui', 'sidebar', 'agents', 'rows')),
                         cp.load_doc().get(('ui', 'sidebar', 'agents', 'rows')))
        # spaces were absent so they materialise; agents stay the live template
        self.assertNotEqual(first, doc.dumps())
        self.assertTrue(cp.has_agent_template(doc.get(('ui', 'sidebar', 'agents', 'rows'))))

    def test_blank_title_tokens_are_kept(self):
        """Startup blanks are still the coloured title slots, not a native fallback."""
        import config_patch as cp
        row = cp.agent_rows_template()[0]
        names = [cp._token_name(e) for e in row]
        self.assertNotIn('agent', names)
        self.assertNotIn('workspace', names)
        self.assertEqual(sum(1 for n in names if n and n.startswith('$title_')), 12)

    def test_rows_by_agent_never_created_or_dotted(self):
        import config_patch as cp
        self.write_config('users_real')
        doc = cp.load_doc()
        cp.install_sidebar(doc)
        self.assertEqual(doc.table_keys(cp.ROWS_BY_AGENT), [])
        self.write_config('rows_by_agent')
        doc = cp.load_doc()
        claude_before = json.dumps(doc.get(('ui', 'sidebar', 'agents', 'rows_by_agent', 'claude')))
        cp.install_sidebar(doc)
        claude_after = json.dumps(doc.get(('ui', 'sidebar', 'agents', 'rows_by_agent', 'claude')))
        self.assertEqual(claude_before, claude_after)
        self.assertFalse(cp.has_dots(
            doc.get(('ui', 'sidebar', 'agents', 'rows_by_agent', 'claude'))))

    def test_exact_rollback_of_owned_rows(self):
        import config_patch as cp
        self.write_config('users_real')
        doc = cp.load_doc()
        original = doc.dumps()
        backup, _c = cp.install_sidebar(doc)
        self.assertNotEqual(doc.dumps(), original)
        cp.remove_sidebar(doc, backup)
        self.assertEqual(doc.dumps(), original)

    def test_live_template_validates(self):
        import config_patch as cp
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(FIXTURES['users_real'])
        os.environ['HERDR_CONFIG_PATH'] = path
        doc = cp.load_doc()
        cp.install_sidebar(doc)
        with open(path, encoding='utf-8') as fh:
            baseline = fh.read()
        ok, out = cp.validate(doc.dumps(), baseline_text=baseline)
        self.assertTrue(ok, out)
        self.assertIn('$elapsed', doc.dumps())
        self.assertIn('$themed_model_tier', doc.dumps())
        self.assertNotIn('$sd_rose', ''.join(
            str(e) for e in doc.get(('ui', 'sidebar', 'agents', 'rows'))[0]))

    def test_restore_keeps_multiline_live_agents_row(self):
        import config_patch as cp
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(LIVE_AGENTS)
        os.environ['HERDR_CONFIG_PATH'] = path
        doc = cp.load_doc()
        original = doc.dumps()
        backup = cp.capture_backup(doc, cp.owned_sidebar_keys())
        cp.restore_backup(doc, backup, tidy_tables=cp.SIDEBAR_TIDY_TABLES)
        self.assertEqual(doc.dumps(), original)
        self.assertTrue(cp.has_agent_template(
            doc.get(('ui', 'sidebar', 'agents', 'rows'))))

    def test_occupied_picker_key_is_not_bound(self):
        import config_patch as cp
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join([
                '[[keys.command]]',
                'key = "prefix+i"',
                'type = "command"',
                'command = "command.palette"',
                '',
            ]))
        os.environ['HERDR_CONFIG_PATH'] = path
        doc = cp.load_doc()
        before = doc.dumps()
        status, bound = cp.install_keybind(
            doc, 'prefix+i', 'iurysza.window-manager.set-identity',
            'Window Manager: set Space colour')
        self.assertEqual(status, 'occupied')
        self.assertEqual(bound, 'command.palette')
        self.assertEqual(doc.dumps(), before)
        self.assertIsNone(cp.keybind_key(doc, 'iurysza.window-manager.set-identity'))


class TestMigration(Base):
    def _write_legacy_state(self, payload):
        d = os.environ['HERDR_LEGACY_CHROMATIC_STATE_DIR']
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, 'state.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh)
        return path

    def test_imports_identities_and_ignores_stale_backups(self):
        import migrate
        import state as st_mod
        legacy_path = self._write_legacy_state({
            'identities': {
                'w1': {'colour': '#7fd6c1', 'origin': 'manual'},
                'w2': {'colour': '#a6d189', 'origin': 'auto'},
            },
            'alloc_cursor': 4,
            'sidebar_backup': {
                'keys': {'ui.sidebar.agents.rows': {'present': False}},
            },
            'theme_backup': {'keys': {'ui.accent': {'present': False}}},
            'last_written': {
                'ui.sidebar.agents.rows': [['state_icon', '$sd_rose']],
            },
            'tint_enabled': True,
        })
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(LIVE_AGENTS)
        os.environ['HERDR_CONFIG_PATH'] = path
        st = st_mod.default_state()
        report = migrate.import_legacy(st)
        self.assertEqual(sorted(report['identities_imported']), ['w1', 'w2'])
        self.assertEqual(st['identities']['w1']['colour'], '#7fd6c1')
        self.assertIn('sidebar_backup', report['ignored_stale_backups'])
        self.assertIn('theme_backup', report['ignored_stale_backups'])
        self.assertIn('last_written', report['ignored_stale_backups'])
        self.assertIsNone(st.get('theme_backup'))
        self.assertNotEqual(st.get('last_written'), {
            'ui.sidebar.agents.rows': [['state_icon', '$sd_rose']],
        })
        self.assertTrue(os.path.exists(legacy_path))
        self.assertTrue(st['ownership_baseline']['keys']['ui.sidebar.agents.rows']['present'])
        # stale Chromatic "absent" backup must not become our restore point
        self.assertTrue(st['sidebar_backup']['keys']['ui.sidebar.agents.rows']['present'])

    def test_remigrate_does_not_overwrite_ownership_baseline(self):
        import migrate
        import state as st_mod
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(LIVE_AGENTS)
        os.environ['HERDR_CONFIG_PATH'] = path
        st = st_mod.default_state()
        keep = {
            'keys': {
                'ui.sidebar.agents.rows': {'present': True, 'value': 'KEEP'},
                'ui.sidebar.spaces.rows': {'present': False},
            }
        }
        st['ownership_baseline'] = keep
        st['sidebar_backup'] = keep
        migrate.import_legacy(st)
        self.assertEqual(
            st['ownership_baseline']['keys']['ui.sidebar.agents.rows']['value'],
            'KEEP')
        self.assertEqual(
            st['sidebar_backup']['keys']['ui.sidebar.agents.rows']['value'],
            'KEEP')

    def test_uninstall_does_not_apply_stale_chromatic_absent_backup(self):
        import config_patch as cp
        import migrate
        import state as st_mod
        self._write_legacy_state({
            'identities': {'w1': {'colour': '#7fd6c1', 'origin': 'manual'}},
            'sidebar_backup': {
                'keys': {'ui.sidebar.agents.rows': {'present': False}},
            },
        })
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(LIVE_AGENTS)
        os.environ['HERDR_CONFIG_PATH'] = path
        st = st_mod.default_state()
        migrate.import_legacy(st)
        doc = cp.load_doc()
        backup, changes = cp.install_sidebar(doc)
        if st.get('sidebar_backup') is None:
            st['sidebar_backup'] = backup
        agent_changes = [c for c in changes if c[0] == 'ui.sidebar.agents.rows']
        self.assertEqual(agent_changes, [])
        restored = cp.restore_backup(doc, st['sidebar_backup'])
        self.assertTrue(cp.has_agent_template(doc.get(('ui', 'sidebar', 'agents', 'rows'))))
        self.assertNotEqual(doc.get(('ui', 'sidebar', 'agents', 'rows')), None)
        labels = [item[0] for item in restored]
        self.assertIn('ui.sidebar.agents.rows', labels)

    def test_conflict_fails_without_force(self):
        import migrate
        import state as st_mod
        self._write_legacy_state({
            'identities': {'w1': {'colour': '#7fd6c1', 'origin': 'manual'}},
        })
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#fab387', origin='manual')
        with self.assertRaises(migrate.MigrationError) as caught:
            migrate.import_legacy(st)
        self.assertIn('identity conflicts', str(caught.exception))
        self.assertEqual(st['identities']['w1']['colour'], '#fab387')

    def test_force_overlays_conflicts(self):
        import migrate
        import state as st_mod
        self._write_legacy_state({
            'identities': {'w1': {'colour': '#7fd6c1', 'origin': 'manual'}},
        })
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#fab387', origin='manual')
        report = migrate.import_legacy(st, force=True)
        self.assertIn('w1', report['identities_imported'])
        self.assertEqual(st['identities']['w1']['colour'], '#7fd6c1')

    def test_dry_run_does_not_write_state_identities(self):
        import migrate
        import state as st_mod
        self._write_legacy_state({
            'identities': {'w1': {'colour': '#7fd6c1', 'origin': 'manual'}},
        })
        st = st_mod.default_state()
        report = migrate.import_legacy(st, dry_run=True)
        self.assertTrue(report['dry_run'])
        self.assertEqual(st.get('identities'), {})

    def test_copies_settings_and_label_rules(self):
        import migrate
        import state as st_mod
        cfg = os.environ['HERDR_LEGACY_CHROMATIC_CONFIG_DIR']
        os.makedirs(cfg, exist_ok=True)
        with open(os.path.join(cfg, 'settings.json'), 'w', encoding='utf-8') as fh:
            json.dump({'intensity': 'bold', 'marker': 'X'}, fh)
        rules = os.path.join(self.tmp, 'rules.json')
        with open(rules, 'w', encoding='utf-8') as fh:
            json.dump({'version': 1, 'identities': {'agents': '#a6d189'}}, fh)
        os.environ['HERDR_LABEL_IDENTITIES_FILE'] = rules
        layouts_cfg = os.environ['HERDR_LEGACY_LAYOUTS_CONFIG_DIR']
        os.makedirs(layouts_cfg, exist_ok=True)
        with open(os.path.join(layouts_cfg, 'settings.json'), 'w', encoding='utf-8') as fh:
            json.dump({'note': 'from-layouts'}, fh)
        st = st_mod.default_state()
        report = migrate.import_legacy(st)
        self.assertTrue(report['settings_copied'])
        self.assertTrue(report['label_rules_copied'])
        self.assertTrue(report['layouts_settings_copied'])
        import ctx
        with open(ctx.settings_path(), encoding='utf-8') as fh:
            self.assertEqual(json.load(fh)['intensity'], 'bold')
        with open(os.path.join(ctx.config_dir(), 'identities.json'), encoding='utf-8') as fh:
            self.assertEqual(json.load(fh)['identities']['agents'], '#a6d189')


class TestLabelRules(Base):
    def test_matching_label_assigns_colour(self):
        import labels
        import state as st_mod
        path = os.path.join(self.tmp, 'rules.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump({'version': 1, 'identities': {'agents': 'sage'}}, fh)
        os.environ['HERDR_LABEL_IDENTITIES_FILE'] = path
        st = st_mod.default_state()
        changed = labels.apply(st, [{'workspace_id': 'w9', 'label': 'agents'}])
        self.assertEqual(changed, ['w9'])
        self.assertEqual(st['identities']['w9'],
                         {'colour': '#a6d189', 'origin': 'label'})

    def test_manual_origin_is_not_overwritten(self):
        import labels
        import state as st_mod
        path = os.path.join(self.tmp, 'rules.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump({'version': 1, 'identities': {'agents': '#a6d189'}}, fh)
        os.environ['HERDR_LABEL_IDENTITIES_FILE'] = path
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w9', '#fab387', origin='manual')
        self.assertEqual(labels.apply(st, [{'workspace_id': 'w9', 'label': 'agents'}]), [])
        self.assertEqual(st['identities']['w9']['colour'], '#fab387')

    def test_invalid_rules_fail_clearly(self):
        import labels
        path = os.path.join(self.tmp, 'rules.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump({'version': 2, 'identities': {}}, fh)
        os.environ['HERDR_LABEL_IDENTITIES_FILE'] = path
        with self.assertRaises(labels.LabelRulesError):
            labels.load_rules()

    def test_label_side_effect_publishes_other_workspace(self):
        import main as main_mod
        import rpc
        import state as st_mod
        path = os.path.join(self.tmp, 'rules.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump({
                'version': 1,
                'identities': {'agents': 'sage', 'api': 'peach'},
            }, fh)
        os.environ['HERDR_LABEL_IDENTITIES_FILE'] = path
        workspaces = [
            {'workspace_id': 'w1', 'label': 'agents'},
            {'workspace_id': 'w2', 'label': 'api'},
        ]
        published = []

        def fake_call(method, params=None, **kw):
            if method == 'workspace.report_metadata':
                published.append(params['workspace_id'])
                return {'type': 'ok'}
            if method == 'workspace.list':
                return {'workspaces': workspaces}
            return {'type': 'ok'}

        rpc.call = fake_call
        st = st_mod.default_state()
        info, created = main_mod._ensure_identity(st, 'w1', workspaces)
        self.assertTrue(created)
        self.assertEqual(info['origin'], 'label')
        self.assertEqual(sorted(published), ['w1', 'w2'])
        self.assertEqual(st['identities']['w2']['origin'], 'label')


class TestLayoutDispatch(Base):
    def test_resize_requires_pane_context(self):
        import layout_actions
        os.environ.pop('HERDR_PANE_ID', None)
        with self.assertRaises(layout_actions.LayoutError):
            layout_actions.run_action('resize-left')

    def test_run_uses_plugin_lock(self):
        import ctx
        import layout_actions
        import rpc
        held = []
        real = ctx.Lock

        class Spy(real):
            def __enter__(self):
                held.append(True)
                return real.__enter__(self)

        ctx.Lock = Spy
        os.environ['HERDR_PANE_ID'] = 'w1:p1'
        calls = []

        def fake_call(method, params=None, **kw):
            self.assertTrue(held)
            calls.append((method, params))
            return {}

        rpc.call = fake_call
        self.assertEqual(layout_actions.run(['resize-left']), 0)
        self.assertTrue(held)
        self.assertEqual(calls[0][0], 'pane.resize')
        self.assertEqual(calls[0][1]['amount'], 0.02)
        self.assertEqual(calls[0][1]['direction'], 'left')

    def test_equalize_single_pane_is_noop(self):
        import layout_actions
        import rpc
        layout = {
            'tab_id': 'w1:t1',
            'workspace_id': 'w1',
            'focused_pane_id': 'w1:p1',
            'zoomed': False,
            'root': {'type': 'pane', 'pane_id': 'w1:p1'},
        }
        calls = []

        def fake_call(method, params=None, **kw):
            calls.append(method)
            if method == 'layout.export':
                return {'layout': layout}
            self.fail('unexpected %s' % method)

        rpc.call = fake_call
        os.environ['HERDR_PANE_ID'] = 'w1:p1'
        self.assertEqual(layout_actions.run(['equalize']), 0)
        self.assertEqual(calls, ['layout.export'])

    def test_zoomed_tab_fails(self):
        import layout_actions
        import rpc
        layout = {
            'tab_id': 'w1:t1',
            'workspace_id': 'w1',
            'focused_pane_id': 'w1:p1',
            'zoomed': True,
            'root': {
                'type': 'split',
                'direction': 'right',
                'ratio': 0.7,
                'first': {'type': 'pane', 'pane_id': 'w1:p1'},
                'second': {'type': 'pane', 'pane_id': 'w1:p2'},
            },
        }

        def fake_call(method, params=None, **kw):
            if method == 'layout.export':
                return {'layout': layout}
            if method == 'notification.show':
                return {}
            self.fail(method)

        rpc.call = fake_call
        os.environ['HERDR_PANE_ID'] = 'w1:p1'
        self.assertEqual(layout_actions.run(['equalize']), 1)

    def test_main_dispatches_layout(self):
        import main as main_mod
        import layout_actions
        seen = []

        def fake_run(argv):
            seen.append(argv)
            return 0

        layout_actions.run = fake_run
        self.assertEqual(main_mod.cmd_layout(['cycle']), 0)
        self.assertEqual(seen, [['cycle']])

    def test_equalize_moves_through_staging_tab(self):
        import layout_actions
        import rpc
        layout = {
            'tab_id': 'w1:t1',
            'workspace_id': 'w1',
            'focused_pane_id': 'w1:p1',
            'zoomed': False,
            'root': {
                'type': 'split',
                'direction': 'right',
                'ratio': 0.7,
                'first': {'type': 'pane', 'pane_id': 'w1:p1'},
                'second': {'type': 'pane', 'pane_id': 'w1:p2'},
            },
        }
        moves = []

        def fake_call(method, params=None, **kw):
            if method == 'layout.export':
                return {'layout': layout}
            if method == 'pane.move':
                dest = params['destination']
                moves.append(dest)
                result = {
                    'changed': True,
                    'pane': {'pane_id': params['pane_id']},
                }
                if dest.get('type') == 'new_tab':
                    result['created_tab'] = {'tab_id': 'w1:t-staging'}
                return {'move_result': result}
            self.fail('unexpected %s' % method)

        rpc.call = fake_call
        os.environ['HERDR_PANE_ID'] = 'w1:p1'
        self.assertEqual(layout_actions.run(['equalize']), 0)
        self.assertEqual(moves[0]['type'], 'new_tab')
        self.assertEqual(moves[0]['workspace_id'], 'w1')
        self.assertEqual(moves[1]['type'], 'tab')
        self.assertEqual(moves[1]['tab_id'], 'w1:t1')
        self.assertEqual(moves[1]['target_pane_id'], 'w1:p1')
        self.assertEqual(moves[1]['split'], 'right')
        self.assertAlmostEqual(moves[1]['ratio'], 0.5)

    def test_layout_error_prefix_is_window_manager(self):
        import io
        import layout_actions
        import rpc
        captured = io.StringIO()

        def fake_call(method, params=None, **kw):
            raise rpc.RpcError('boom', 'nope')

        rpc.call = fake_call
        os.environ['HERDR_PANE_ID'] = 'w1:p1'
        old = sys.stderr
        sys.stderr = captured
        try:
            self.assertEqual(layout_actions.run(['resize-left']), 1)
        finally:
            sys.stderr = old
        self.assertIn('window-manager:', captured.getvalue())
        self.assertNotIn('pane-layouts:', captured.getvalue())


class TestInstallLifecycle(Base):
    def test_idempotent_sidebar_install_records_last_written(self):
        import main as main_mod
        import state as st_mod
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(FIXTURES['already_installed'] + '\n' + LIVE_AGENTS)
        os.environ['HERDR_CONFIG_PATH'] = path
        self.assertEqual(main_mod.cmd_sidebar_install([]), 0)
        st = st_mod.load()
        self.assertIn('ui.sidebar.agents.rows', st['last_written'])
        self.assertIn('ui.sidebar.spaces.rows', st['last_written'])
        self.assertTrue(st['sidebar_installed'])

    def test_install_dry_run_does_not_write_sidebar_or_state(self):
        import main as main_mod
        import state as st_mod
        d = os.environ['HERDR_LEGACY_CHROMATIC_STATE_DIR']
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'state.json'), 'w', encoding='utf-8') as fh:
            json.dump({
                'identities': {'w1': {'colour': '#7fd6c1', 'origin': 'manual'}},
            }, fh)
        path = os.path.join(self.tmp, 'config.toml')
        original = FIXTURES['users_real']
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(original)
        os.environ['HERDR_CONFIG_PATH'] = path
        self.assertEqual(main_mod.cmd_install(['--dry-run']), 0)
        with open(path, encoding='utf-8') as fh:
            self.assertEqual(fh.read(), original)
        self.assertEqual(st_mod.load().get('identities'), {})
        self.assertFalse(os.path.exists(os.path.join(
            os.environ['HERDR_PLUGIN_STATE_DIR'], 'state.json')))

    def test_install_keeps_migrated_view_mode(self):
        import main as main_mod
        d = os.environ['HERDR_LEGACY_CHROMATIC_STATE_DIR']
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'state.json'), 'w', encoding='utf-8') as fh:
            json.dump({'view_mode': 'current', 'identities': {}}, fh)
        seen = []

        def fake_view(argv):
            seen.append(list(argv))
            return 0

        main_mod.cmd_sidebar_install = lambda a: 0
        main_mod.cmd_keybind_install = lambda a: 0
        main_mod.cmd_reconcile = lambda a: 0
        main_mod.cmd_view = fake_view
        self.assertEqual(main_mod.cmd_install([]), 0)
        self.assertEqual(seen, [['current']])

    def test_doctor_warns_rows_by_agent_hides_template(self):
        import io
        import main as main_mod
        self.write_config('rows_by_agent')
        buf = io.StringIO()
        old = sys.stdout
        sys.stdout = buf
        try:
            self.assertEqual(main_mod.cmd_doctor([]), 0)
        finally:
            sys.stdout = old
        text = buf.getvalue()
        self.assertIn('ui.sidebar.agents.rows_by_agent.claude', text)
        self.assertIn('fully replaces', text)

    def _stub_rpc(self):
        import rpc

        def fake_call(method, params=None, **kw):
            if method == 'workspace.list':
                return {'workspaces': []}
            if method == 'agent.list':
                return {'agents': []}
            if method == 'server.reload_config':
                return {'status': 'applied', 'diagnostics': []}
            if method == 'agent.view.set':
                return {'active': True, 'source': 'iurysza.window-manager',
                        'label': 'Spaces'}
            if method == 'agent.view.clear':
                return {'active': False}
            return {'type': 'ok'}

        rpc.call = fake_call

    def test_second_ownership_cycle_restores_current_preplugin_rows(self):
        """Uninstall must not reuse the first-cycle baseline on reinstall."""
        import config_patch as cp
        import main as main_mod
        import state as st_mod
        self._stub_rpc()
        path = os.path.join(self.tmp, 'config.toml')
        cycle_a = '\n'.join([
            '[ui.sidebar.agents]',
            'rows = [["state_icon", "workspace", "tab"], ["agent"]]',
            '',
            '[ui.sidebar.spaces]',
            'rows = [["state_icon", "workspace"], ["branch", "git_status"]]',
            '',
        ])
        cycle_b = '\n'.join([
            '[ui.sidebar.agents]',
            'rows = [["state_icon", "agent"]]',
            '',
            '[ui.sidebar.spaces]',
            'rows = [["state_icon", "workspace"], ["branch", "git_status"]]',
            '',
        ])
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(cycle_a)
        os.environ['HERDR_CONFIG_PATH'] = path

        self.assertEqual(main_mod.cmd_install([]), 0)
        st = st_mod.load()
        self.assertEqual(
            st['sidebar_backup']['keys']['ui.sidebar.agents.rows']['value'],
            [['state_icon', 'workspace', 'tab'], ['agent']])
        self.assertEqual(main_mod.cmd_uninstall([]), 0)
        st = st_mod.load()
        self.assertIsNone(st.get('sidebar_backup'))
        self.assertIsNone(st.get('ownership_baseline'))
        self.assertEqual(st.get('last_written'), {})
        self.assertEqual(
            cp.load_doc().get(('ui', 'sidebar', 'agents', 'rows')),
            [['state_icon', 'workspace', 'tab'], ['agent']])

        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(cycle_b)
        self.assertEqual(main_mod.cmd_install([]), 0)
        st = st_mod.load()
        self.assertEqual(
            st['sidebar_backup']['keys']['ui.sidebar.agents.rows']['value'],
            [['state_icon', 'agent']])
        self.assertEqual(
            st['ownership_baseline']['keys']['ui.sidebar.agents.rows']['value'],
            [['state_icon', 'agent']])
        self.assertEqual(main_mod.cmd_uninstall([]), 0)
        doc = cp.load_doc()
        self.assertEqual(
            doc.get(('ui', 'sidebar', 'agents', 'rows')),
            [['state_icon', 'agent']])
        self.assertEqual(
            doc.get(('ui', 'sidebar', 'spaces', 'rows')),
            [['state_icon', 'workspace'], ['branch', 'git_status']])
        with open(path, encoding='utf-8') as fh:
            restored = fh.read()
        self.assertEqual(restored, cycle_b)


class TestManifest(Base):
    def test_plugin_id_and_interpreter_paths(self):
        path = os.path.join(ROOT, 'herdr-plugin.toml')
        with open(path, encoding='utf-8') as fh:
            text = fh.read()
        self.assertIn('id = "iurysza.window-manager"', text)
        self.assertNotIn('jackfrancisdalton.chromatic-spaces', text)
        self.assertNotIn('[[build]]', text)
        self.assertIn('layout equalize', text)
        self.assertIn('layout cycle', text)
        for direction in ('resize-left', 'resize-down', 'resize-up', 'resize-right'):
            self.assertIn('layout %s' % direction, text)
        self.assertIn('migrate', text)
        commands = re.findall(r'^command = (.+)$', text, re.M)
        self.assertTrue(commands)
        for cmd in commands:
            self.assertIn('/usr/bin/python3', cmd)
            self.assertNotIn('"python3"', cmd)
            self.assertIn('$HERDR_PLUGIN_ROOT', cmd)

    def test_ctx_plugin_id(self):
        import ctx
        self.assertEqual(ctx.PLUGIN_ID, 'iurysza.window-manager')


class TestArgvParse(unittest.TestCase):
    def test_parse_kv_accepts_bare_and_dashed_key(self):
        import main as main_mod
        self.assertEqual(
            main_mod._parse_kv(['key=prefix+shift+i']),
            {'key': 'prefix+shift+i'})
        self.assertEqual(
            main_mod._parse_kv(['--key=prefix+shift+i']),
            {'key': 'prefix+shift+i'})
        self.assertEqual(
            main_mod._parse_kv(['--key', 'prefix+shift+i']),
            {'key': 'prefix+shift+i'})


if __name__ == '__main__':
    unittest.main()
