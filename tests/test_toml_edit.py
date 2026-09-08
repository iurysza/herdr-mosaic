import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from toml_edit import (MISSING, TomlDoc, TomlEditError, dump_value, parse_value,
                       split_key_path)

REAL_CONFIG = """onboarding = false
# [ui]
# agent_panel_sort = "priority"

[theme]
# name = "one-dark"

name = "gruvbox"
auto_switch = false
[ui]
agent_panel_sort = "priority"
show_agent_labels_on_pane_borders = true
sidebar_width = 34

[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.agents.rows_by_agent]
claude = [["state_icon", "workspace", "tab"], ["terminal_title_stripped"], ["agent"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"]]


[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "herdr-file-viewer.open-file-viewer"
"""


class TestKeyPaths(unittest.TestCase):
    def test_bare(self):
        self.assertEqual(split_key_path('ui.sidebar.spaces'), ('ui', 'sidebar', 'spaces'))

    def test_quoted(self):
        self.assertEqual(split_key_path('a."b.c".d'), ('a', 'b.c', 'd'))


class TestValues(unittest.TestCase):
    def test_nested_array(self):
        v = parse_value('[["state_icon", "workspace"], ["branch"]]')
        self.assertEqual(v, [['state_icon', 'workspace'], ['branch']])

    def test_inline_table(self):
        v = parse_value('{token = "workspace", fg = "#89b4fa", bold = true}')
        self.assertEqual(v, {'token': 'workspace', 'fg': '#89b4fa', 'bold': True})

    def test_roundtrip_emoji(self):
        self.assertEqual(parse_value(dump_value('\U0001f310')), '\U0001f310')

    def test_dump_nested(self):
        self.assertEqual(dump_value([['a'], ['b', 'c']]), '[["a"], ["b", "c"]]')


class TestReadReal(unittest.TestCase):
    def setUp(self):
        self.doc = TomlDoc(REAL_CONFIG)

    def test_exact_roundtrip_no_edits(self):
        self.assertEqual(self.doc.dumps(), REAL_CONFIG)

    def test_read_theme_name(self):
        self.assertEqual(self.doc.get(('theme', 'name')), 'gruvbox')

    def test_read_spaces_rows(self):
        self.assertEqual(self.doc.get(('ui', 'sidebar', 'spaces', 'rows')),
                         [['state_icon', 'workspace'], ['branch', 'git_status']])

    def test_read_agents_rows(self):
        self.assertEqual(self.doc.get(('ui', 'sidebar', 'agents', 'rows')),
                         [['state_icon', 'workspace', 'tab'], ['agent']])

    def test_read_rows_by_agent_claude(self):
        self.assertEqual(
            self.doc.get(('ui', 'sidebar', 'agents', 'rows_by_agent', 'claude')),
            [['state_icon', 'workspace', 'tab'], ['terminal_title_stripped'], ['agent']])

    def test_commented_key_not_found(self):
        # `# agent_panel_sort` at the top is a comment, the real one is in [ui]
        self.assertEqual(self.doc.get(('ui', 'agent_panel_sort')), 'priority')

    def test_missing_key(self):
        self.assertIs(self.doc.get(('theme', 'custom', 'accent')), MISSING)
        self.assertFalse(self.doc.has(('ui', 'accent')))

    def test_aot_not_treated_as_table(self):
        self.assertIs(self.doc.get(('keys', 'command', 'key')), MISSING)


class TestWrite(unittest.TestCase):
    def setUp(self):
        self.doc = TomlDoc(REAL_CONFIG)

    def test_set_existing_scalar_preserves_rest(self):
        self.doc.set(('theme', 'name'), 'nord')
        out = self.doc.dumps()
        self.assertIn('name = "nord"', out)
        self.assertIn('# name = "one-dark"', out)      # comment preserved
        self.assertIn('onboarding = false', out)
        self.assertEqual(out.count('[theme]'), 1)

    def test_set_new_key_in_existing_table(self):
        self.doc.set(('ui', 'accent'), '#a970ff')
        self.assertEqual(self.doc.get(('ui', 'accent')), '#a970ff')
        # count real headers only -- the fixture also has a commented '# [ui]'
        headers = [l for l in self.doc.dumps().splitlines() if l.strip() == '[ui]']
        self.assertEqual(len(headers), 1)

    def test_set_creates_new_table(self):
        self.doc.set(('theme', 'custom', 'accent'), '#4f8cff')
        out = self.doc.dumps()
        self.assertEqual(out.count('[theme.custom]'), 1)
        self.assertEqual(TomlDoc(out).get(('theme', 'custom', 'accent')), '#4f8cff')

    def test_set_array_replaces_value(self):
        rows = [['state_icon', '$space_emoji', 'workspace'], ['branch', 'git_status']]
        self.doc.set(('ui', 'sidebar', 'spaces', 'rows'), rows)
        self.assertEqual(self.doc.get(('ui', 'sidebar', 'spaces', 'rows')), rows)
        self.assertEqual(self.doc.dumps().count('[ui.sidebar.spaces]'), 1)

    def test_unset_restores_original_text(self):
        self.doc.set(('theme', 'custom', 'accent'), '#4f8cff')
        self.doc.unset(('theme', 'custom', 'accent'))
        self.assertTrue(self.doc.table_is_empty(('theme', 'custom')))
        self.doc.remove_table(('theme', 'custom'))
        self.assertEqual(self.doc.dumps(), REAL_CONFIG)

    def test_set_then_restore_scalar_is_byte_exact(self):
        orig = self.doc.get(('theme', 'name'))
        self.doc.set(('theme', 'name'), 'nord')
        self.doc.set(('theme', 'name'), orig)
        self.assertEqual(self.doc.dumps(), REAL_CONFIG)

    def test_table_is_empty_false_when_children(self):
        self.assertFalse(self.doc.table_is_empty(('ui', 'sidebar', 'agents')))


class TestEdgeCases(unittest.TestCase):
    def test_multiline_array(self):
        src = 'x = 1\n[ui.sidebar.spaces]\nrows = [\n  ["state_icon"],\n  ["branch"],\n]\ny = 2\n'
        d = TomlDoc(src)
        self.assertEqual(d.get(('ui', 'sidebar', 'spaces', 'rows')),
                         [['state_icon'], ['branch']])
        d.set(('ui', 'sidebar', 'spaces', 'rows'), [['a']])
        out = d.dumps()
        self.assertIn('rows = [["a"]]', out)
        self.assertIn('y = 2', out)

    def test_dotted_key_in_parent_table(self):
        src = '[ui]\nsidebar.spaces.rows = [["state_icon"]]\n'
        d = TomlDoc(src)
        self.assertEqual(d.get(('ui', 'sidebar', 'spaces', 'rows')), [['state_icon']])
        d.set(('ui', 'sidebar', 'spaces', 'rows'), [['b']])
        self.assertIn('sidebar.spaces.rows = [["b"]]', d.dumps())

    def test_hash_inside_string_not_comment(self):
        d = TomlDoc('[theme.custom]\naccent = "#a970ff" # my accent\n')
        self.assertEqual(d.get(('theme', 'custom', 'accent')), '#a970ff')
        d.set(('theme', 'custom', 'accent'), '#123456')
        out = d.dumps()
        self.assertIn('# my accent', out)
        self.assertEqual(TomlDoc(out).get(('theme', 'custom', 'accent')), '#123456')

    def test_crlf_preserved(self):
        d = TomlDoc('[theme]\r\nname = "x"\r\n')
        d.set(('theme', 'name'), 'y')
        self.assertIn('\r\n', d.dumps())

    def test_no_trailing_newline_preserved(self):
        d = TomlDoc('[theme]\nname = "x"')
        self.assertEqual(d.dumps(), '[theme]\nname = "x"')

    def test_bracket_in_string_not_header(self):
        d = TomlDoc('a = "[not.a.header]"\n[theme]\nname = "x"\n')
        self.assertEqual(d.get(('theme', 'name')), 'x')
        self.assertEqual(d.get(('a',)), '[not.a.header]')

    def test_empty_file(self):
        d = TomlDoc('')
        d.set(('ui', 'accent'), '#fff')
        self.assertEqual(TomlDoc(d.dumps()).get(('ui', 'accent')), '#fff')


if __name__ == '__main__':
    unittest.main(verbosity=2)
