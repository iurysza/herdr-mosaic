"""Standalone sidebar contract: titles, clocks, and optional themed metadata."""
import os
from unittest import mock

from test_plugin import Base


class TestSidebar(Base):
    def test_tab_title_matches_existing_service_and_clears_other_colours(self):
        import sidebar
        tokens = sidebar.title_tokens(
            {'pane_id': 'w1:p1', 'workspace_id': 'w1', 'tab_id': 'w1:t1',
             'terminal_title_stripped': 'terminal'},
            {'w1:t1': 'Fix auth'}, {'w1': {'colour': '#7aa2f7'}})
        self.assertEqual(len(tokens), 12)
        self.assertEqual(tokens['title_azure'], 'Fix auth')
        self.assertEqual(sum(value is not None for value in tokens.values()), 1)

    def test_no_tab_label_still_has_a_visible_name(self):
        import sidebar
        for key in ('terminal_title_stripped', 'name', 'display_agent', 'agent'):
            tokens = sidebar.title_tokens({'pane_id': 'p1', key: 'Name'}, {}, {})
            self.assertIn('Name', tokens.values())
        self.assertIn('p1', sidebar.title_tokens({'pane_id': 'p1'}, {}, {}).values())

    def test_custom_colour_uses_nearest_slot(self):
        import identity
        import sidebar
        tokens = sidebar.title_tokens({'pane_id': 'p1', 'workspace_id': 'w1'}, {},
                                      {'w1': {'colour': '#ff1234'}})
        self.assertEqual(tokens['title_' + identity.slot_for_colour('#ff1234')], 'p1')

    def test_publish_preserves_durable_titles_and_external_model_tier(self):
        import sidebar
        import ctx
        import state
        calls = []

        def call(method, params):
            if method == 'tab.list':
                return {'tabs': [{'tab_id': 't1', 'label': 'Task'}]}
            calls.append((method, params))
            return {}

        st = state.default_state()
        st['agent_settled'] = {'p1': {'last_settled_at': 100}}
        with ctx.Lock(), mock.patch('rpc.call', side_effect=call), \
                mock.patch('time.time', return_value=220):
            self.assertEqual(sidebar.publish(st, [{'pane_id': 'p1', 'tab_id': 't1'}]), 1)
        title, clock = [params for _, params in calls]
        self.assertEqual(title['source'], 'agent-sidebar-title')
        self.assertNotIn('ttl_ms', title)
        self.assertEqual(clock['source'], 'agent-elapsed')
        self.assertEqual(clock['tokens'], {'elapsed': '2m'})
        self.assertEqual(clock['ttl_ms'], 45000)
        self.assertNotIn('themed_model_tier', title['tokens'])
        self.assertNotIn('themed_model_tier', clock['tokens'])

    def test_uninstalled_sidebar_does_not_publish(self):
        import sidebar
        with mock.patch('rpc.call') as call:
            sidebar.publish_once()
        call.assert_not_called()

    def test_clear_leaves_themed_source_alone(self):
        import sidebar
        import ctx
        with ctx.Lock(), mock.patch('rpc.try_call', return_value=({}, None)) as call:
            sidebar.clear([{'pane_id': 'p1'}])
        self.assertEqual({args[0][1]['source'] for args in call.call_args_list},
                         {'agent-sidebar-title', 'agent-elapsed'})
        self.assertTrue(all(value is None for args in call.call_args_list
                            for value in args[0][1]['tokens'].values()))


class TestRefresh(Base):
    def test_registration_requires_enabled_matching_checkout(self):
        import ctx
        import refresh
        plugin = {'plugin_id': ctx.PLUGIN_ID, 'enabled': True,
                  'plugin_root': ctx.plugin_root()}
        with mock.patch('rpc.call', return_value={'plugins': [plugin]}):
            self.assertTrue(refresh.registered())
            plugin['enabled'] = False
            self.assertFalse(refresh.registered())
            plugin['enabled'] = True
            plugin['plugin_root'] = '/another/checkout'
            self.assertFalse(refresh.registered())

    def test_workers_are_scoped_to_socket_generation(self):
        import refresh
        self.assertNotEqual(refresh.paths('socket-A:1:2'), refresh.paths('socket-B:1:2'))
        self.assertNotEqual(refresh.paths('socket-A:1:2'), refresh.paths('socket-A:1:3'))

    def test_reused_socket_inode_has_a_new_generation(self):
        import refresh
        info = mock.Mock(st_dev=1, st_ino=2, st_ctime_ns=100)
        with mock.patch('refresh.os.stat', return_value=info):
            before = refresh.generation()
            self.assertEqual(refresh.generation(), before)
            info.st_ctime_ns = 101
            after = refresh.generation()
        self.assertNotEqual(before, after)
        self.assertNotEqual(refresh.paths(before), refresh.paths(after))

    def test_worker_exits_without_publishing_after_disable(self):
        import refresh
        with mock.patch('refresh.generation', return_value='generation'), \
                mock.patch('refresh.registered', return_value=False), \
                mock.patch('sidebar.publish') as publish:
            self.assertEqual(refresh.run('generation'), 0)
        publish.assert_not_called()

    def test_worker_exits_without_publishing_for_replaced_socket(self):
        import refresh
        with mock.patch('refresh.generation', return_value='new-generation'), \
                mock.patch('sidebar.publish') as publish:
            self.assertEqual(refresh.run('old-generation'), 0)
        publish.assert_not_called()

    def test_worker_exits_when_ownership_ends(self):
        import refresh
        with mock.patch('refresh.generation', return_value='generation'), \
                mock.patch('refresh.registered', return_value=True), \
                mock.patch('sidebar.publish') as publish:
            self.assertEqual(refresh.run('generation'), 0)
        publish.assert_not_called()

    def test_a_second_worker_cannot_publish(self):
        import ctx
        import refresh
        lock_name, _ = refresh.paths('generation')
        with ctx.Lock(lock_name), mock.patch('sidebar.publish') as publish:
            self.assertEqual(refresh.run('generation'), 0)
        publish.assert_not_called()

    def test_start_without_sidebar_does_not_spawn(self):
        import refresh
        with mock.patch('subprocess.Popen') as spawn:
            refresh.start()
        spawn.assert_not_called()
