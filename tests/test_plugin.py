"""Behavioural tests for herdr-space-identity.

These run fully isolated: state and config dirs are redirected to a temp tree and
config edits target temp files, so the user's real Herdr config is never touched.
Config validation still invokes the real `herdr config check` binary, which is
the point -- candidate configs are checked by Herdr itself.
"""

import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'src'))

# --- fixtures: several plausible real-world Herdr configs -------------------

FIXTURES = {}

import importlib
import sys as _sys
_sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src'))
_PALETTE = importlib.import_module('identity').PALETTE


def _dots_literal(*wrap):
    toks = ", ".join('{ token = "$sd_%s", fg = "%s" }' % (n, h) for n, h in _PALETTE)
    inner = ", ".join([wrap[0], toks] + list(wrap[1:]))
    return "[%s]" % inner

FIXTURES['users_real'] = """onboarding = false
# [ui]
# agent_panel_sort = "priority"

[theme]
# name = "one-dark"

name = "gruvbox"
auto_switch = false
[ui]
agent_panel_sort = "priority"
sidebar_width = 34

[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.spaces]
rows = [["state_icon", "workspace"], ["branch", "git_status"]]


[[keys.command]]
key = "prefix+f"
type = "plugin_action"
command = "herdr-file-viewer.open-file-viewer"
"""

FIXTURES['empty'] = ""

FIXTURES['no_sidebar'] = """[theme]
name = "catppuccin"

[terminal]
default_shell = "/bin/zsh"
"""

FIXTURES['multiline_rows'] = """[ui.sidebar.spaces]
# my carefully arranged rows
rows = [
  ["state_icon", "workspace"],
  ["branch", "git_status"],
]

[ui]
sidebar_width = 30
"""

FIXTURES['styled_rows'] = """[ui.sidebar.agents]
rows = [[{ token = "state_icon" }, { token = "workspace", fg = "#89b4fa", bold = true }], ["agent"]]
"""

FIXTURES['styled_spaces'] = """[ui.sidebar.spaces]
rows = [[{ token = "state_icon" }, { token = "workspace", fg = "#89b4fa", bold = true }], ["branch", "git_status"]]
"""

FIXTURES['existing_theme_custom'] = """[theme]
name = "nord"

[theme.custom]
# I like this pink
accent = "#f5c2e7"
red = "#ff6188"

[ui]
accent = "cyan"
"""

FIXTURES['already_installed'] = '[ui.sidebar.spaces]\nrows = [' + _dots_literal(
    '"state_icon"', '"workspace"') + ']\n'

FIXTURES['legacy_emoji'] = """[ui.sidebar.spaces]
rows = [["state_icon", "$space_emoji", "workspace"], ["branch", "git_status"]]

[ui.sidebar.agents]
rows = [["state_icon", "$space_emoji", "workspace", "tab"], ["agent"]]
"""

FIXTURES['rows_by_agent'] = """[ui.sidebar.agents]
rows = [["state_icon", "workspace", "tab"], ["agent"]]

[ui.sidebar.agents.rows_by_agent]
claude = [["state_icon", "workspace", "tab"], ["agent"]]
"""


class Base(unittest.TestCase):
    ENV_KEYS = (
        'HERDR_PLUGIN_STATE_DIR', 'HERDR_PLUGIN_CONFIG_DIR', 'HERDR_CONFIG_PATH',
        'HERDR_SOCKET_PATH', 'HERDR_LEGACY_CHROMATIC_STATE_DIR',
        'HERDR_LEGACY_CHROMATIC_CONFIG_DIR', 'HERDR_LEGACY_LAYOUTS_STATE_DIR',
        'HERDR_LEGACY_LAYOUTS_CONFIG_DIR', 'HERDR_LABEL_IDENTITIES_FILE',
        'HERDR_PLUGIN_ID', 'HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR',
        'HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR',
    )

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='space-identity-test-')
        self._saved_env = {k: os.environ.get(k) for k in self.ENV_KEYS}
        for key in ('HERDR_PLUGIN_ID', 'HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR',
                    'HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR'):
            os.environ.pop(key, None)
        os.environ['HERDR_LEGACY_WINDOW_MANAGER_STATE_DIR'] = os.path.join(
            self.tmp, 'legacy-window-manager-state')
        os.environ['HERDR_LEGACY_WINDOW_MANAGER_CONFIG_DIR'] = os.path.join(
            self.tmp, 'legacy-window-manager-config')
        os.environ['HERDR_PLUGIN_STATE_DIR'] = os.path.join(self.tmp, 'state')
        os.environ['HERDR_PLUGIN_CONFIG_DIR'] = os.path.join(self.tmp, 'config')
        os.environ['HERDR_CONFIG_PATH'] = os.path.join(self.tmp, 'config.toml')
        os.environ['HERDR_SOCKET_PATH'] = os.path.join(self.tmp, 'herdr.sock')
        os.environ['HERDR_LEGACY_CHROMATIC_STATE_DIR'] = os.path.join(
            self.tmp, 'legacy-chromatic-state')
        os.environ['HERDR_LEGACY_CHROMATIC_CONFIG_DIR'] = os.path.join(
            self.tmp, 'legacy-chromatic-config')
        os.environ['HERDR_LEGACY_LAYOUTS_STATE_DIR'] = os.path.join(
            self.tmp, 'legacy-layouts-state')
        os.environ['HERDR_LEGACY_LAYOUTS_CONFIG_DIR'] = os.path.join(
            self.tmp, 'legacy-layouts-config')
        os.environ['HERDR_LABEL_IDENTITIES_FILE'] = os.path.join(
            self.tmp, 'missing-identities.json')
        os.makedirs(os.environ['HERDR_PLUGIN_STATE_DIR'])
        os.makedirs(os.environ['HERDR_PLUGIN_CONFIG_DIR'])
        for mod in ('ctx', 'state', 'identity', 'theme', 'config_patch',
                    'metadata', 'agent_view', 'toml_edit', 'rpc', 'main',
                    'labels', 'migrate', 'layouts', 'layout_actions',
                    'agent_tracker', 'sidebar', 'refresh', 'elapsed'):
            sys.modules.pop(mod, None)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def write_config(self, name):
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(FIXTURES[name])
        os.environ['HERDR_CONFIG_PATH'] = path
        return path


# --------------------------------------------------------------------------

class TestState(Base):
    def test_serialization_roundtrip(self):
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w4', '#4f8cff', origin='manual')
        st['tint_enabled'] = True
        st_mod.save(st)
        back = st_mod.load()
        self.assertEqual(back['identities']['w4'],
                         {'colour': '#4f8cff', 'origin': 'manual'})
        self.assertTrue(back['tint_enabled'])

    def test_colour_survives_json_roundtrip(self):
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#35c7c7')
        st_mod.save(st)
        self.assertEqual(st_mod.load()['identities']['w1']['colour'], '#35c7c7')

    def test_corrupt_state_falls_back(self):
        import ctx
        import state as st_mod
        with open(os.path.join(ctx.state_dir(), 'state.json'), 'w') as fh:
            fh.write('{not json')
        self.assertEqual(st_mod.load()['identities'], {})

    def test_unknown_future_keys_preserved(self):
        import ctx
        import state as st_mod
        with open(os.path.join(ctx.state_dir(), 'state.json'), 'w') as fh:
            json.dump({'identities': {}, 'future_key': 'keep me'}, fh)
        self.assertEqual(st_mod.load().get('future_key'), 'keep me')


class TestIdentity(Base):
    def workspaces(self, n):
        return [{'workspace_id': 'w%d' % i, 'number': i} for i in range(1, n + 1)]

    def test_default_allocation_is_deterministic(self):
        import identity as ident
        import state as st_mod
        a, b = st_mod.default_state(), st_mod.default_state()
        ws = self.workspaces(5)
        ident.ensure_all(a, ws)
        ident.ensure_all(b, ws)
        self.assertEqual(a['identities'], b['identities'])

    def test_adjacent_spaces_get_different_colours(self):
        import identity as ident
        import state as st_mod
        st = st_mod.default_state()
        ws = self.workspaces(10)
        ident.ensure_all(st, ws)
        cols = [st['identities']['w%d' % i]['colour'] for i in range(1, 11)]
        for a, b in zip(cols, cols[1:]):
            self.assertNotEqual(a, b)

    def test_palette_slots_are_distinct(self):
        import identity as ident
        self.assertEqual(len(ident.SLOT_NAMES), len(set(ident.SLOT_NAMES)))
        hexes = [h for _n, h in ident.PALETTE]
        self.assertEqual(len(hexes), len(set(hexes)))

    def test_slot_tokens_are_valid_metadata_names(self):
        import re as _re
        import identity as ident
        for tok in ident.all_slot_tokens():
            self.assertTrue(_re.match(r'^[A-Za-z0-9_-]{1,32}$', tok), tok)

    def test_exact_palette_colour_maps_to_own_slot(self):
        import identity as ident
        for name, hexv in ident.PALETTE:
            self.assertEqual(ident.slot_for_colour(hexv), name)

    def test_custom_hex_borrows_nearest_slot(self):
        import identity as ident
        self.assertFalse(ident.is_exact_palette_colour('#ff00aa'))
        self.assertIn(ident.slot_for_colour('#ff00aa'), ident.SLOT_NAMES)

    def test_identity_has_no_emoji_field(self):
        import identity as ident
        import state as st_mod
        st = st_mod.default_state()
        ident.ensure_all(st, self.workspaces(3))
        for info in st['identities'].values():
            self.assertNotIn('emoji', info)
            self.assertIn('colour', info)

    def test_palette_is_clear_of_status_colours(self):
        """Every Space colour must be unmistakable against gruvbox status hues."""
        import identity as ident
        for status in ('#fb4934', '#b8bb26', '#fabd2f'):   # red, green, yellow
            for name, hexv in ident.PALETTE:
                self.assertGreater(ident.distance(hexv, status), 110,
                                   '%s too close to %s' % (name, status))

    def test_palette_is_pastel(self):
        """Light and moderately saturated -- the register dev themes use."""
        import colorsys
        import identity as ident
        import theme as th
        for name, hexv in ident.PALETTE:
            self.assertTrue(150 <= th.luminance(hexv) <= 215,
                            '%s luminance %.0f' % (name, th.luminance(hexv)))
            r, g, b = [c / 255.0 for c in th.parse_hex(hexv)]
            sat = colorsys.rgb_to_hsv(r, g, b)[1]
            self.assertTrue(0.18 <= sat <= 0.60, '%s sat %.2f' % (name, sat))

    def test_palette_has_twelve_distinct_slots(self):
        import identity as ident
        self.assertEqual(len(ident.PALETTE), 12)
        self.assertEqual(len(set(h for _n, h in ident.PALETTE)), 12)

    def test_palette_fits_the_row_token_cap(self):
        """Spaces dots and the 15-token agent row each stay within 16 tokens."""
        import config_patch as cp
        merged = cp.insert_tokens(cp.DEFAULT_SPACES_ROWS, cp.dot_tokens())
        cp._check_limits(merged, 'spaces')
        self.assertLessEqual(max(len(r) for r in merged), cp.MAX_TOKENS_PER_ROW)
        agents = cp.agent_rows_template()
        cp._check_limits(agents, 'agents')
        self.assertEqual(len(agents[0]), 15)

    def test_allocation_maximises_distance_from_neighbours(self):
        import identity as ident
        import state as st_mod
        st = st_mod.default_state()
        ws = self.workspaces(6)
        ident.ensure_all(st, ws)
        self.assertEqual(ident.close_pairs(st, ws), [])

    def test_close_pairs_detects_similar_colours(self):
        import identity as ident
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#cba6f7')      # mauve
        st_mod.set_identity(st, 'w2', '#e0a3e8')      # orchid -- close to mauve
        ws = self.workspaces(2)
        self.assertTrue(ident.close_pairs(st, ws))

    def test_migration_drops_emoji_and_keeps_manual_colour(self):
        import state as st_mod
        import ctx, json as _json, os as _os
        import identity as ident
        on_palette = ident.PALETTE[0][1]
        legacy = {'identities': {
            'w1': {'emoji': '\U0001F310', 'colour': on_palette, 'origin': 'auto'},
            'w2': {'emoji': '\U0001F680', 'colour': '#123456', 'origin': 'manual'},
            'w3': {'emoji': '\U0001F9F0', 'colour': '#6c7bff', 'origin': 'auto'},
        }}
        with open(_os.path.join(ctx.state_dir(), 'state.json'), 'w') as fh:
            _json.dump(legacy, fh)
        st = st_mod.load()
        ids = st['identities']
        # an on-palette auto colour is kept, minus the emoji field
        self.assertNotIn('emoji', ids['w1'])
        self.assertEqual(ids['w1']['colour'], on_palette)
        # a manual colour survives even though it is not a palette slot
        self.assertEqual(ids['w2']['colour'], '#123456')
        self.assertNotIn('emoji', ids['w2'])
        # an auto colour no longer in the palette is dropped for reallocation
        self.assertNotIn('w3', ids)

    def test_identity_stable_across_rename(self):
        """Identity is keyed on workspace ID, so a label change cannot affect it."""
        import identity as ident
        import state as st_mod
        st = st_mod.default_state()
        ident.ensure_all(st, [{'workspace_id': 'w4', 'number': 1,
                               'label': 'Website'}])
        before = dict(st['identities']['w4'])
        # same ID, new label
        ident.ensure_all(st, [{'workspace_id': 'w4', 'number': 1,
                               'label': 'Marketing Site'}])
        self.assertEqual(st['identities']['w4'], before)

    def test_ensure_all_is_idempotent(self):
        import identity as ident
        import state as st_mod
        st = st_mod.default_state()
        ws = self.workspaces(4)
        first = ident.ensure_all(st, ws)
        second = ident.ensure_all(st, ws)
        self.assertEqual(len(first), 4)
        self.assertEqual(second, [])

    def test_manual_identity_not_overwritten(self):
        import identity as ident
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#a970ff', origin='manual')
        ident.ensure_all(st, self.workspaces(3))
        self.assertEqual(st['identities']['w1']['colour'], '#a970ff')

    def test_resolve_colour(self):
        import identity as ident
        self.assertEqual(ident.resolve_colour('azure'), '#7aa2f7')
        self.assertEqual(ident.resolve_colour('#ABCDEF'), '#abcdef')
        self.assertEqual(ident.resolve_colour('#abc'), '#aabbcc')
        self.assertIsNone(ident.resolve_colour('not-a-colour'))
        self.assertIsNone(ident.resolve_colour('#12345'))


class TestBlending(Base):
    def test_endpoints(self):
        import theme as th
        self.assertEqual(th.blend('#282828', '#4f8cff', 0.0), '#282828')
        self.assertEqual(th.blend('#282828', '#4f8cff', 1.0), '#4f8cff')

    def test_midpoint(self):
        import theme as th
        self.assertEqual(th.blend('#000000', '#ffffff', 0.5), '#808080')

    def test_surfaces_stay_dark_and_ordered(self):
        import theme as th
        vals = th.generate('#a970ff', 'gruvbox', th.ctx.DEFAULT_SETTINGS)
        lum = lambda h: sum(th.parse_hex(h))
        self.assertLess(lum(vals['theme.custom.panel_bg']), 3 * 90)
        self.assertLess(lum(vals['theme.custom.panel_bg']),
                        lum(vals['theme.custom.surface1']))
        self.assertEqual(vals['theme.custom.accent'], '#a970ff')

    def test_never_touches_semantic_or_text_slots(self):
        import theme as th
        for colour in ('#4f8cff', '#a970ff', '#35c7c7', '#d9a441'):
            vals = th.generate(colour, 'gruvbox', th.ctx.DEFAULT_SETTINGS)
            for protected in th.PROTECTED_KEYS:
                self.assertNotIn(protected, vals)

    def test_base_lookup_per_theme(self):
        import theme as th
        s = {'theme_base': 'auto', 'blend': {}}
        self.assertEqual(th.resolve_base('gruvbox', s), '#282828')
        self.assertEqual(th.resolve_base('tokyo-night', s), '#1a1b26')
        self.assertEqual(th.resolve_base('catppuccin-mocha', s), '#1e1e2e')
        self.assertEqual(th.resolve_base('something-unknown', s), th.FALLBACK_BASE)

    def test_explicit_base_override(self):
        import theme as th
        self.assertEqual(th.resolve_base('gruvbox',
                                         {'theme_base': '#000000', 'blend': {}}),
                         '#000000')

    def test_different_spaces_produce_different_values(self):
        import theme as th
        s = th.ctx.DEFAULT_SETTINGS
        a = th.generate('#7aa2f7', 'gruvbox', s)
        b = th.generate('#cba6f7', 'gruvbox', s)
        self.assertNotEqual(a, b)
        for k in a:
            self.assertNotEqual(a[k], b[k], k)


class TestIntensity(Base):
    def test_presets_are_monotonic(self):
        import theme as th
        keys = ('panel_bg', 'surface_dim', 'surface0', 'surface1')
        order = ['subtle', 'medium', 'bold']
        for k in keys:
            vals = [th.INTENSITY[n][k] for n in order]
            self.assertEqual(vals, sorted(vals), k)

    def test_within_each_preset_surfaces_ascend(self):
        import theme as th
        for name, mix in th.INTENSITY.items():
            self.assertLess(mix['panel_bg'], mix['surface_dim'], name)
            self.assertLess(mix['surface_dim'], mix['surface0'], name)
            self.assertLess(mix['surface0'], mix['surface1'], name)

    def test_bolder_intensity_moves_further_from_base(self):
        import theme as th
        base = th.resolve_base('gruvbox', {'theme_base': 'auto'})

        def dist(name):
            st = {'intensity': name, 'blend': {}, 'theme_base': 'auto'}
            v = th.generate('#4f8cff', 'gruvbox', st)['theme.custom.surface1']
            a, b = th.parse_hex(base), th.parse_hex(v)
            return sum((a[i] - b[i]) ** 2 for i in range(3))

        self.assertLess(dist('subtle'), dist('medium'))
        self.assertLess(dist('medium'), dist('bold'))

    def test_bold_surfaces_are_still_dark_for_every_pastel(self):
        """Light pastels must not wash the chrome out, even at bold."""
        import identity as ident
        import theme as th
        st = {'intensity': 'bold', 'blend': {}, 'theme_base': 'auto'}
        for _name, colour in ident.PALETTE:
            vals = th.generate(colour, 'gruvbox', st)
            for key in ('panel_bg', 'surface_dim', 'surface0', 'surface1'):
                self.assertLessEqual(th.luminance(vals['theme.custom.' + key]),
                                     th.LUMA_CEILING[key] + 0.5,
                                     '%s %s over ceiling' % (colour, key))

    def test_luminance_cap_is_solved_exactly(self):
        import theme as th
        capped = th.blend_capped('#282828', '#f5c2e7', 0.9, 102.0)
        self.assertAlmostEqual(th.luminance(capped), 102.0, delta=1.0)

    def test_cap_does_not_raise_dark_colours(self):
        """A colour darker than the ceiling is blended at full strength."""
        import theme as th
        full = th.blend('#282828', '#4f8cff', 0.2)
        self.assertEqual(th.blend_capped('#282828', '#4f8cff', 0.2, 102.0), full)

    def test_every_pastel_reaches_its_ceiling_at_bold(self):
        """All Spaces get equally deep chrome; only the hue differs."""
        import identity as ident
        import theme as th
        st = {'intensity': 'bold', 'blend': {}, 'theme_base': 'auto'}
        lums = set()
        for _name, colour in ident.PALETTE:
            v = th.generate(colour, 'gruvbox', st)['theme.custom.surface1']
            lums.add(round(th.luminance(v)))
        self.assertLessEqual(max(lums) - min(lums), 2)

    def test_intensity_never_touches_semantic_slots(self):
        import theme as th
        for name in th.INTENSITY:
            st = {'intensity': name, 'blend': {}, 'theme_base': 'auto'}
            vals = th.generate('#4f8cff', 'gruvbox', st)
            for protected in th.PROTECTED_KEYS:
                self.assertNotIn(protected, vals)

    def test_overlays_follow_preset_unless_forced(self):
        import theme as th
        self.assertFalse(th.resolve_overlays({'intensity': 'subtle'}))
        self.assertTrue(th.resolve_overlays({'intensity': 'bold'}))
        self.assertFalse(th.resolve_overlays({'intensity': 'bold',
                                              'tint_overlays': False}))
        self.assertTrue(th.resolve_overlays({'intensity': 'subtle',
                                             'tint_overlays': True}))

    def test_managed_keys_match_generated_keys(self):
        """Whatever we generate must also be backed up and restorable."""
        import theme as th
        for name in th.INTENSITY:
            st = {'intensity': name, 'blend': {}, 'theme_base': 'auto'}
            gen = set(th.generate('#4f8cff', 'gruvbox', st))
            self.assertEqual(gen, set(th.managed_keys(st)), name)

    def test_explicit_blend_overrides_preset(self):
        import theme as th
        st = {'intensity': 'subtle', 'blend': {'surface1': 0.5},
              'theme_base': 'auto'}
        self.assertEqual(th.resolve_blend(st)['surface1'], 0.5)
        self.assertEqual(th.resolve_blend(st)['panel_bg'],
                         th.INTENSITY['subtle']['panel_bg'])

    def test_unknown_intensity_falls_back(self):
        import theme as th
        self.assertEqual(th.intensity_name({'intensity': 'nonsense'}),
                         th.DEFAULT_INTENSITY)

    def test_blend_is_clamped(self):
        import theme as th
        st = {'intensity': 'bold', 'blend': {'surface1': 99}, 'theme_base': 'auto'}
        self.assertLessEqual(th.resolve_blend(st)['surface1'], 0.75)

    def test_swatch_is_truecolor_escape(self):
        import theme as th
        self.assertTrue(th.swatch('#4f8cff').startswith('\x1b[48;2;79;140;255m'))

    def test_save_settings_merges(self):
        import ctx
        ctx.save_settings({'intensity': 'bold'})
        ctx.save_settings({'marker': 'X'})
        s = ctx.settings()
        self.assertEqual(s['intensity'], 'bold')
        self.assertEqual(s['marker'], 'X')


class TestConfigPatch(Base):
    def _doc(self, fixture):
        import config_patch as cp
        self.write_config(fixture)
        return cp, cp.load_doc()

    def test_sidebar_install_merges_users_real_config(self):
        cp, doc = self._doc('users_real')
        _backup, changes = cp.install_sidebar(doc)
        labels = {c[0] for c in changes}
        self.assertIn('ui.sidebar.spaces.rows', labels)
        self.assertIn('ui.sidebar.agents.rows', labels)

    def test_existing_rows_by_agent_is_preserved(self):
        """Agent dots are gone; pre-existing rows_by_agent entries stay untouched."""
        cp, doc = self._doc('rows_by_agent')
        before = doc.get(('ui', 'sidebar', 'agents', 'rows_by_agent', 'claude'))
        before_dump = doc.dumps()
        _backup, changes = cp.install_sidebar(doc)
        labels = {c[0] for c in changes}
        self.assertNotIn('ui.sidebar.agents.rows_by_agent.claude', labels)
        self.assertEqual(
            doc.get(('ui', 'sidebar', 'agents', 'rows_by_agent', 'claude')), before)
        self.assertFalse(cp.has_dots(
            doc.get(('ui', 'sidebar', 'agents', 'rows_by_agent', 'claude'))))
        self.assertIn('[ui.sidebar.agents.rows_by_agent]', doc.dumps())
        self.assertIn(before_dump.split('[ui.sidebar.agents.rows_by_agent]')[1],
                      doc.dumps())

    def test_new_rows_by_agent_entries_are_never_created(self):
        cp, doc = self._doc('users_real')
        cp.install_sidebar(doc)
        self.assertEqual(doc.table_keys(cp.ROWS_BY_AGENT), [])

    def test_installed_rows_have_correct_order(self):
        """Spaces keep dots after state_icon; agents get the 15-token title row."""
        import identity as ident
        cp, doc = self._doc('users_real')
        cp.install_sidebar(doc)
        n = len(ident.PALETTE)
        row = doc.get(('ui', 'sidebar', 'spaces', 'rows'))[0]
        self.assertEqual(row[0], 'state_icon')
        slots = [e['token'] for e in row[1:1 + n]]
        self.assertEqual(slots, ['$' + t for t in ident.all_slot_tokens()])
        self.assertEqual(row[1 + n], 'workspace')
        agents = doc.get(('ui', 'sidebar', 'agents', 'rows'))[0]
        self.assertEqual(agents[0], 'state_icon')
        self.assertEqual(agents[1]['token'], '$elapsed')
        titles = [e['token'] for e in agents[2:2 + n]]
        self.assertEqual(titles, ['$title_' + name for name, _h in ident.PALETTE])
        self.assertEqual(agents[-1]['token'], '$themed_model_tier')
        self.assertEqual(len(agents), 15)
        self.assertFalse(cp.has_dots(doc.get(('ui', 'sidebar', 'agents', 'rows'))))

    def test_each_slot_token_carries_its_own_static_colour(self):
        import identity as ident
        cp, doc = self._doc('users_real')
        cp.install_sidebar(doc)
        row = doc.get(('ui', 'sidebar', 'spaces', 'rows'))[0]
        styled = {e['token']: e['fg'] for e in row if isinstance(e, dict)}
        for name, hexv in ident.PALETTE:
            self.assertEqual(styled['$' + ident.slot_token(name)], hexv)

    def test_state_icon_still_present(self):
        cp, doc = self._doc('users_real')
        cp.install_sidebar(doc)
        for path in (('ui', 'sidebar', 'spaces', 'rows'),
                     ('ui', 'sidebar', 'agents', 'rows')):
            rows = doc.get(path)
            self.assertTrue(cp.row_has_token(rows, 'state_icon'), path)

    def test_branch_and_git_status_preserved(self):
        cp, doc = self._doc('users_real')
        cp.install_sidebar(doc)
        rows = doc.get(('ui', 'sidebar', 'spaces', 'rows'))
        self.assertIn(['branch', 'git_status'], rows)

    def test_legacy_emoji_token_is_replaced_by_dots(self):
        cp, doc = self._doc('legacy_emoji')
        cp.install_sidebar(doc)
        out = doc.dumps()
        self.assertNotIn('$space_emoji', out)
        self.assertTrue(cp.has_dots(doc.get(('ui', 'sidebar', 'spaces', 'rows'))))
        self.assertFalse(cp.has_dots(doc.get(('ui', 'sidebar', 'agents', 'rows'))))
        self.assertTrue(cp.has_agent_template(doc.get(('ui', 'sidebar', 'agents', 'rows'))))

    def test_install_is_idempotent(self):
        cp, doc = self._doc('users_real')
        cp.install_sidebar(doc)
        first = doc.dumps()
        _b2, changes2 = cp.install_sidebar(doc)
        self.assertEqual(changes2, [])
        self.assertEqual(doc.dumps(), first)

    def test_already_installed_fixture_is_noop(self):
        """An already-dotted row set is left byte-identical."""
        cp, doc = self._doc('already_installed')
        before = doc.get(('ui', 'sidebar', 'spaces', 'rows'))
        _b, changes = cp.install_sidebar(doc)
        self.assertEqual([c for c in changes
                          if c[0].startswith('ui.sidebar.spaces')], [])
        self.assertEqual(doc.get(('ui', 'sidebar', 'spaces', 'rows')), before)

    def test_materialises_defaults_when_absent(self):
        cp, doc = self._doc('no_sidebar')
        _b, changes = cp.install_sidebar(doc)
        self.assertTrue(any(c[1] == 'materialised default' for c in changes))
        rows = doc.get(('ui', 'sidebar', 'spaces', 'rows'))
        self.assertTrue(cp.has_dots(rows))
        self.assertEqual(rows[0][0], 'state_icon')
        self.assertEqual(rows[0][-1], 'workspace')
        self.assertEqual(rows[1], ['branch', 'git_status'])

    def test_preserves_unrelated_config(self):
        cp, doc = self._doc('users_real')
        cp.install_sidebar(doc)
        out = doc.dumps()
        for needle in ('onboarding = false', 'sidebar_width = 34',
                       'agent_panel_sort = "priority"',
                       'key = "prefix+f"', '# name = "one-dark"',
                       'herdr-file-viewer.open-file-viewer'):
            self.assertIn(needle, out, needle)

    def test_preserves_comments_in_multiline_rows(self):
        cp, doc = self._doc('multiline_rows')
        cp.install_sidebar(doc)
        out = doc.dumps()
        self.assertIn('# my carefully arranged rows', out)
        self.assertIn('sidebar_width = 30', out)

    def test_styled_tokens_preserved(self):
        cp, doc = self._doc('styled_spaces')
        cp.install_sidebar(doc)
        rows = doc.get(('ui', 'sidebar', 'spaces', 'rows'))
        self.assertEqual(rows[0][0], {'token': 'state_icon'})
        self.assertTrue(cp.has_dots(rows))
        self.assertEqual(rows[0][-1],
                         {'token': 'workspace', 'fg': '#89b4fa', 'bold': True})

    def test_custom_agent_rows_are_replaced_with_title_template(self):
        cp, doc = self._doc('styled_rows')
        backup, changes = cp.install_sidebar(doc)
        self.assertIn('ui.sidebar.agents.rows', {c[0] for c in changes})
        self.assertTrue(cp.has_agent_template(
            doc.get(('ui', 'sidebar', 'agents', 'rows'))))
        self.assertTrue(backup['keys']['ui.sidebar.agents.rows']['present'])

    def test_exact_restoration_of_sidebar(self):
        cp, doc = self._doc('users_real')
        original = doc.dumps()
        backup, _c = cp.install_sidebar(doc)
        self.assertNotEqual(doc.dumps(), original)
        cp.remove_sidebar(doc, backup)
        self.assertEqual(doc.dumps(), original)

    def test_exact_restoration_when_key_was_absent(self):
        cp, doc = self._doc('no_sidebar')
        original = doc.dumps()
        backup, _c = cp.install_sidebar(doc)
        cp.remove_sidebar(doc, backup)
        self.assertEqual(doc.dumps().strip(), original.strip())

    def test_theme_backup_distinguishes_absent_from_present(self):
        cp, doc = self._doc('existing_theme_custom')
        backup = cp.capture_backup(doc, ['theme.custom.accent',
                                         'theme.custom.surface0', 'ui.accent'])
        keys = backup['keys']
        self.assertEqual(keys['theme.custom.accent'],
                         {'present': True, 'value': '#f5c2e7'})
        self.assertEqual(keys['theme.custom.surface0'], {'present': False})
        self.assertEqual(keys['ui.accent'], {'present': True, 'value': 'cyan'})

    def test_theme_apply_then_exact_restore(self):
        import theme as th
        cp, doc = self._doc('existing_theme_custom')
        original = doc.dumps()
        # production backs up the union, since overlays ride with intensity
        keys = sorted(set(th.TINT_KEYS) | set(th.OVERLAY_KEYS))
        backup = cp.capture_backup(doc, keys)
        cp.apply_values(doc, th.generate('#a970ff', 'nord',
                                         th.ctx.DEFAULT_SETTINGS))
        self.assertNotEqual(doc.dumps(), original)
        cp.restore_backup(doc, backup, tidy_tables=(('theme', 'custom'),))
        self.assertEqual(doc.dumps(), original)

    def test_restore_preserves_users_red_override(self):
        import theme as th
        cp, doc = self._doc('existing_theme_custom')
        backup = cp.capture_backup(doc,
                                   sorted(set(th.TINT_KEYS) | set(th.OVERLAY_KEYS)))
        cp.apply_values(doc, th.generate('#4f8cff', 'nord',
                                         th.ctx.DEFAULT_SETTINGS))
        # the user's semantic override is untouched throughout
        self.assertEqual(doc.get(('theme', 'custom', 'red')), '#ff6188')
        cp.restore_backup(doc, backup, tidy_tables=(('theme', 'custom'),))
        self.assertEqual(doc.get(('theme', 'custom', 'red')), '#ff6188')
        self.assertIn('# I like this pink', doc.dumps())

    def test_conflict_detection(self):
        cp, doc = self._doc('existing_theme_custom')
        last_written = {'theme.custom.accent': '#111111'}
        conflicts = cp.detect_conflicts(doc, last_written)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0][0], 'theme.custom.accent')
        self.assertEqual(conflicts[0][2], '#f5c2e7')

    def test_no_conflict_when_values_match(self):
        cp, doc = self._doc('existing_theme_custom')
        self.assertEqual(
            cp.detect_conflicts(doc, {'theme.custom.accent': '#f5c2e7'}), [])

    def test_restore_skips_user_modified_key(self):
        cp, doc = self._doc('existing_theme_custom')
        backup = cp.capture_backup(doc, ['theme.custom.accent'])
        results = cp.restore_backup(doc, backup, skip={'theme.custom.accent'})
        self.assertEqual(results, [('theme.custom.accent',
                                    'skipped (user-modified)')])

    def test_every_fixture_validates_after_install(self):
        """Patched output of every fixture passes the real `herdr config check`."""
        import config_patch as cp
        for name in FIXTURES:
            self.write_config(name)
            doc = cp.load_doc()
            cp.install_sidebar(doc)
            import theme as th
            cp.apply_values(doc, th.generate('#4f8cff', 'gruvbox',
                                             th.ctx.DEFAULT_SETTINGS))
            with open(os.environ['HERDR_CONFIG_PATH'], encoding='utf-8') as fh:
                baseline = fh.read()
            ok, out = cp.validate(doc.dumps(), baseline_text=baseline)
            self.assertTrue(ok, "%s did not validate: %s" % (name, out))

    def test_preexisting_warning_does_not_block_writes(self):
        """A config that already warns must still be patchable."""
        import config_patch as cp
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('[theme]\nname = "gruvbox"\nlegacy_unknown_key = 1\n')
        os.environ['HERDR_CONFIG_PATH'] = path
        doc = cp.load_doc()
        cp.install_sidebar(doc)
        cp.commit(doc)          # must not raise
        with open(path, encoding='utf-8') as fh:
            written = fh.read()
        import identity as ident
        self.assertIn('$' + ident.all_slot_tokens()[0], written)
        self.assertIn('legacy_unknown_key = 1', written)

    def test_new_diagnostic_still_blocks(self):
        import config_patch as cp
        path = os.path.join(self.tmp, 'config.toml')
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('[theme]\nname = "gruvbox"\nlegacy_unknown_key = 1\n')
        os.environ['HERDR_CONFIG_PATH'] = path
        doc = cp.load_doc()
        doc.set(('ui', 'sidebar', 'spaces', 'rows'), [['not_a_real_token']])
        with self.assertRaises(cp.ConfigError):
            cp.commit(doc)

    def test_commit_refuses_invalid_config(self):
        import config_patch as cp
        path = self.write_config('users_real')
        doc = cp.load_doc()
        doc.set(('ui', 'sidebar', 'spaces', 'rows'), [['not_a_real_token']])
        with self.assertRaises(cp.ConfigError):
            cp.commit(doc)
        # the file on disk is untouched
        with open(path, encoding='utf-8') as fh:
            self.assertEqual(fh.read(), FIXTURES['users_real'])

    def test_row_limits_enforced(self):
        """8 dot slots plus a long existing row must fail loudly, not silently."""
        import config_patch as cp
        rows = [['state_icon'] + ['workspace'] * 12]
        merged = cp.insert_tokens(rows, cp.dot_tokens())
        with self.assertRaises(cp.ConfigError) as caught:
            cp._check_limits(merged, 'test')
        self.assertIn('max 16', str(caught.exception))

    def test_row_limits_ok_for_realistic_rows(self):
        import config_patch as cp
        cp._check_limits(cp.insert_tokens(cp.DEFAULT_SPACES_ROWS, cp.dot_tokens()),
                         'spaces')
        cp._check_limits(cp.agent_rows_template(), 'agents')
        self.assertEqual(cp.agent_row_token_count(), 15)


class TestAgentView(Base):
    def test_definition_sorts_by_space(self):
        import agent_view as av
        d = av.definition('all')
        self.assertEqual([s['field'] for s in d['sort']],
                         ['workspace_order', 'tab_order', 'pane_order'])
        self.assertTrue(all(s['order'] == 'asc' for s in d['sort']))
        self.assertNotIn('filter', d)

    def test_definition_is_plugin_owned(self):
        import agent_view as av
        import ctx
        self.assertEqual(av.definition('all')['source'], ctx.PLUGIN_ID)

    def test_current_mode_filters_on_live_context(self):
        import agent_view as av
        d = av.definition('current')
        self.assertEqual(d['filter'], {
            'op': 'eq', 'field': 'workspace_id',
            'value': {'context': 'current_workspace_id'}})

    def test_definition_does_not_touch_status(self):
        """The view must not filter or reorder by agent state."""
        import agent_view as av
        for mode in ('all', 'current'):
            blob = json.dumps(av.definition(mode))
            for word in ('status', 'attention', 'blocked', 'working', 'idle'):
                self.assertNotIn(word, blob, '%s leaked into %s view' % (word, mode))


class TestMetadata(Base):
    def _stub_rpc(self, workspaces, agents):
        import rpc
        self.calls = []

        def fake_call(method, params=None, **kw):
            self.calls.append((method, params))
            if method == 'workspace.list':
                return {'workspaces': workspaces}
            if method == 'agent.list':
                return {'agents': agents}
            return {'type': 'ok'}

        rpc.call = fake_call
        return rpc

    def test_reconcile_publishes_workspaces_and_agent_panes(self):
        ws = [{'workspace_id': 'w1', 'number': 1, 'label': 'Website'},
              {'workspace_id': 'w2', 'number': 2, 'label': 'API'}]
        ag = [{'pane_id': 'w1:p1', 'workspace_id': 'w1', 'agent': 'claude'},
              {'pane_id': 'w2:p1', 'workspace_id': 'w2', 'agent': 'codex'}]
        self._stub_rpc(ws, ag)
        import metadata
        import state as st_mod
        st = st_mod.default_state()
        summary = metadata.reconcile(st, ws, ag, quiet=True)
        self.assertEqual(summary['workspaces'], 2)
        self.assertEqual(summary['panes'], 2)
        self.assertEqual(sorted(summary['identities_assigned']), ['w1', 'w2'])

    def test_pane_inherits_parent_space_identity(self):
        ws = [{'workspace_id': 'w1', 'number': 1, 'label': 'Website'}]
        ag = [{'pane_id': 'w1:p1', 'workspace_id': 'w1', 'agent': 'claude'}]
        self._stub_rpc(ws, ag)
        import metadata
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#4f8cff')
        metadata.reconcile(st, ws, ag, quiet=True)
        pane_calls = [p for m, p in self.calls if m == 'pane.report_metadata']
        self.assertEqual(len(pane_calls), 1)
        import identity as ident
        toks = pane_calls[0]['tokens']
        self.assertEqual(toks['space_name'], 'Website')
        active = [k for k in ident.all_slot_tokens() if toks.get(k)]
        self.assertEqual(active, [ident.slot_token(ident.slot_for_colour('#4f8cff'))])

    def test_pane_move_changes_identity(self):
        """A pane moved from Website to API reports API's emoji."""
        ws = [{'workspace_id': 'w1', 'number': 1, 'label': 'Website'},
              {'workspace_id': 'w2', 'number': 2, 'label': 'API'}]
        self._stub_rpc(ws, [])
        import metadata
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#4f8cff')
        st_mod.set_identity(st, 'w2', '#a970ff')
        metadata.republish_pane(st, 'w1:p3', ws)
        metadata.republish_pane(st, 'w2:p3', ws)   # same process, new pane id
        import identity as ident
        tokens = [p['tokens'] for m, p in self.calls if m == 'pane.report_metadata']
        first = [k for k in ident.all_slot_tokens() if tokens[0].get(k)]
        second = [k for k in ident.all_slot_tokens() if tokens[1].get(k)]
        self.assertEqual(first, [ident.slot_token(ident.slot_for_colour('#4f8cff'))])
        self.assertEqual(second, [ident.slot_token(ident.slot_for_colour('#a970ff'))])
        self.assertNotEqual(first, second)

    def test_workspace_id_derived_from_pane_id(self):
        import metadata
        self.assertEqual(metadata.workspace_id_of_pane('wF:p2'), 'wF')
        self.assertIsNone(metadata.workspace_id_of_pane(''))

    def test_reconcile_is_idempotent(self):
        ws = [{'workspace_id': 'w1', 'number': 1, 'label': 'Website'}]
        ag = [{'pane_id': 'w1:p1', 'workspace_id': 'w1', 'agent': 'claude'}]
        self._stub_rpc(ws, ag)
        import metadata
        import state as st_mod
        st = st_mod.default_state()
        first = metadata.reconcile(st, ws, ag, quiet=True)
        ident_after = json.dumps(st['identities'], sort_keys=True)
        second = metadata.reconcile(st, ws, ag, quiet=True)
        self.assertEqual(second['identities_assigned'], [])
        self.assertEqual(first['workspaces'], second['workspaces'])
        self.assertEqual(json.dumps(st['identities'], sort_keys=True), ident_after)

    def test_reconcile_republishes_after_metadata_loss(self):
        """Herdr drops metadata on restart; state is the source of truth."""
        ws = [{'workspace_id': 'w1', 'number': 1, 'label': 'Website'}]
        ag = [{'pane_id': 'w1:p1', 'workspace_id': 'w1', 'agent': 'claude'}]
        self._stub_rpc(ws, ag)
        import metadata
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#d9a441')
        st_mod.save(st)
        reloaded = st_mod.load()          # simulates a fresh plugin process
        metadata.reconcile(reloaded, ws, ag, quiet=True)
        import identity as ident
        published = [p for m, p in self.calls if m == 'workspace.report_metadata']
        toks = published[0]['tokens']
        active = [k for k in ident.all_slot_tokens() if toks.get(k)]
        self.assertEqual(active, [ident.slot_token(ident.slot_for_colour('#d9a441'))])


class TestTintEfficiency(Base):
    def _setup(self, fixture='users_real'):
        self.write_config(fixture)
        import rpc
        self.reloads = []
        self.ws = [{'workspace_id': 'w1', 'number': 1, 'label': 'Website',
                    'focused': True},
                   {'workspace_id': 'w2', 'number': 2, 'label': 'API'}]

        def fake_call(method, params=None, **kw):
            if method == 'workspace.list':
                return {'workspaces': self.ws}
            if method == 'agent.list':
                return {'agents': []}
            if method == 'server.reload_config':
                self.reloads.append(1)
                return {'type': 'config_reload', 'status': 'applied',
                        'diagnostics': []}
            return {'type': 'ok'}

        rpc.call = fake_call
        import main as main_mod
        import state as st_mod
        st = st_mod.default_state()
        st_mod.set_identity(st, 'w1', '#4f8cff')
        st_mod.set_identity(st, 'w2', '#a970ff')
        st['tint_enabled'] = True
        return main_mod, st

    def test_first_apply_writes_and_reloads_once(self):
        main_mod, st = self._setup()
        status, _v = main_mod._apply_tint(st, 'w1')
        self.assertEqual(status, 'applied')
        self.assertEqual(len(self.reloads), 1)

    def test_duplicate_focus_event_is_a_noop(self):
        main_mod, st = self._setup()
        main_mod._apply_tint(st, 'w1')
        status, _v = main_mod._apply_tint(st, 'w1')
        self.assertEqual(status, 'noop')
        self.assertEqual(len(self.reloads), 1, 'a repeat focus caused a 2nd reload')

    def test_many_duplicate_events_still_one_reload(self):
        main_mod, st = self._setup()
        for _ in range(10):
            main_mod._apply_tint(st, 'w1')
        self.assertEqual(len(self.reloads), 1)

    def test_genuine_space_change_writes_again(self):
        main_mod, st = self._setup()
        main_mod._apply_tint(st, 'w1')
        status, _v = main_mod._apply_tint(st, 'w2')
        self.assertEqual(status, 'applied')
        self.assertEqual(len(self.reloads), 2)

    def test_tint_does_not_write_semantic_colours(self):
        import config_patch as cp
        import theme as th
        main_mod, st = self._setup('existing_theme_custom')
        main_mod._apply_tint(st, 'w1')
        doc = cp.load_doc()
        self.assertEqual(doc.get(('theme', 'custom', 'red')), '#ff6188')
        for key in th.PROTECTED_KEYS:
            self.assertNotIn(key, st['last_written'])

    def test_tint_then_restore_is_byte_exact(self):
        main_mod, st = self._setup('users_real')
        path = os.environ['HERDR_CONFIG_PATH']
        with open(path, encoding='utf-8') as fh:
            original = fh.read()
        main_mod._apply_tint(st, 'w1')
        with open(path, encoding='utf-8') as fh:
            self.assertNotEqual(fh.read(), original)
        import config_patch as cp
        doc = cp.load_doc()
        main_mod._restore_theme(st, doc)
        cp.commit(doc)
        with open(path, encoding='utf-8') as fh:
            self.assertEqual(fh.read(), original)

    def test_conflict_blocks_overwrite(self):
        import config_patch as cp
        main_mod, st = self._setup()
        main_mod._apply_tint(st, 'w1')
        # user hand-edits the accent afterwards
        doc = cp.load_doc()
        doc.set(('theme', 'custom', 'accent'), '#123456')
        cp.commit(doc)
        st['last_tint'] = None
        status, _v = main_mod._apply_tint(st, 'w2')
        self.assertEqual(status, 'conflict')
        self.assertEqual(cp.load_doc().get(('theme', 'custom', 'accent')),
                         '#123456')

    def test_force_overrides_conflict(self):
        import config_patch as cp
        main_mod, st = self._setup()
        main_mod._apply_tint(st, 'w1')
        doc = cp.load_doc()
        doc.set(('theme', 'custom', 'accent'), '#123456')
        cp.commit(doc)
        st['last_tint'] = None
        status, _v = main_mod._apply_tint(st, 'w2', force=True)
        self.assertEqual(status, 'applied')
        self.assertEqual(cp.load_doc().get(('theme', 'custom', 'accent')),
                         '#a970ff')


if __name__ == '__main__':
    unittest.main(verbosity=1)
