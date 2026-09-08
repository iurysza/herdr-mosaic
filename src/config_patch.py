"""Safe, reversible edits to the user's Herdr config.toml.

Every write goes through the same gate:

  read -> edit in place (surgical) -> validate candidate with
  `herdr config check` -> atomic temp+rename

Validation runs the real Herdr binary against the candidate file via
HERDR_CONFIG_PATH, so a malformed or semantically invalid config is rejected
*before* it can replace the user's file. Nothing is ever regenerated from
defaults.
"""

import os
import shutil
import subprocess
import time

import ctx
from toml_edit import MISSING, TomlDoc, dump_value

SPACES_ROWS = ("ui", "sidebar", "spaces", "rows")
AGENTS_ROWS = ("ui", "sidebar", "agents", "rows")
ROWS_BY_AGENT = ("ui", "sidebar", "agents", "rows_by_agent")

# Herdr's documented defaults, materialised when the user has no explicit rows.
DEFAULT_SPACES_ROWS = [["state_icon", "workspace"], ["branch", "git_status"]]
# Chromatic's old agent default. Kept for tests/migration comparison only.
LEGACY_CHROMATIC_AGENTS_ROWS = [["state_icon", "workspace", "tab"], ["agent"]]

LEGACY_EMOJI_TOKEN = "$space_emoji"
SPACE_NAME_TOKEN = "$space_name"

MAX_ROWS = 16
MAX_TOKENS_PER_ROW = 16


def dot_tokens():
    """Pre-styled slot tokens, in palette order.

    Each carries its own static `fg`, because Herdr cannot colour a token from a
    metadata value. Only the slot matching a Space is given a value at runtime,
    so one coloured dot shows per row.
    """
    import identity as ident
    return [{"token": "$" + ident.slot_token(name), "fg": hexv}
            for name, hexv in ident.PALETTE]


def title_tokens():
    """Coloured title slots published by Mosaic; unused slots remain blank."""
    import identity as ident
    return [{"token": "$title_" + name, "fg": hexv, "dim": False}
            for name, hexv in ident.PALETTE]


def agent_rows_template():
    """Owned agents sidebar: elapsed + 12 title slots + themed tier. 15 tokens."""
    return [[
        "state_icon",
        {"token": "$elapsed", "dim": True},
    ] + title_tokens() + [
        {"token": "$themed_model_tier", "dim": True},
    ]]


def _normalize_entry(entry):
    if isinstance(entry, dict):
        return ("dict", entry.get("token"), entry.get("fg"), entry.get("dim"))
    return ("str", entry)


def _normalize_rows(rows):
    return [tuple(_normalize_entry(e) for e in (row or [])) for row in (rows or [])]


def has_agent_template(rows):
    return _normalize_rows(rows) == _normalize_rows(agent_rows_template())


def has_title_tokens(rows):
    if not isinstance(rows, (list, tuple)):
        return False
    names = {_bare(t["token"]) for t in title_tokens()}
    for row in rows or []:
        for entry in row or []:
            if _bare(_token_name(entry)) in names:
                return True
    return False


def agent_row_token_count(rows=None):
    rows = agent_rows_template() if rows is None else rows
    if not rows:
        return 0
    return len(rows[0])


class ConfigError(Exception):
    pass


class Conflict(Exception):
    def __init__(self, details):
        Exception.__init__(self, "; ".join(
            "%s: plugin wrote %r, config now has %r" % (k, exp, act)
            for k, exp, act in details))
        self.details = details


def dotted(key):
    return tuple(key.split(".")) if isinstance(key, str) else tuple(key)


def load_doc(path=None):
    path = path or ctx.herdr_config_path()
    if not os.path.exists(path):
        return TomlDoc("")
    return TomlDoc.load(path)


# --------------------------------------------------------------------------
# validation + atomic write
# --------------------------------------------------------------------------

def _run_check(text):
    """Run `herdr config check` on candidate text. -> (rc, output)."""
    tmp = os.path.join(ctx.state_dir(), ".candidate.%d.toml" % os.getpid())
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
        env = dict(os.environ)
        env["HERDR_CONFIG_PATH"] = tmp
        try:
            proc = subprocess.Popen(
                [ctx.herdr_bin(), "config", "check"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
            out, _ = proc.communicate(timeout=20)
            rc = proc.returncode
        except (OSError, subprocess.SubprocessError) as exc:
            return None, "could not run `herdr config check`: %s" % exc
        return rc, (out or b"").decode("utf-8", "replace").strip()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def _diag_lines(output):
    """Diagnostic lines, minus the summary header."""
    out = set()
    for line in (output or "").splitlines():
        line = line.strip()
        if not line or line.startswith("config: "):
            continue
        out.add(line)
    return out


def validate(text, baseline_text=None):
    """Check candidate text with the real Herdr binary.

    Diagnostics already present in `baseline_text` are tolerated: a user whose
    config has a pre-existing warning (an unknown key from a newer/older Herdr,
    say) must still be able to use the plugin. Only a parse error, or a *new*
    diagnostic that this plugin's edit introduced, blocks the write.
    """
    rc, out = _run_check(text)
    if rc is None:
        return False, out
    if "config parse error" in out:
        return False, out
    if rc == 0:
        return True, out
    if baseline_text is None:
        return False, out
    brc, bout = _run_check(baseline_text)
    if brc is None:
        return False, out
    introduced = _diag_lines(out) - _diag_lines(bout)
    if introduced:
        return False, "new diagnostics introduced: %s" % "; ".join(sorted(introduced))
    return True, out


def snapshot(path=None):
    """Copy the whole config aside once per plugin run, for belt-and-braces."""
    path = path or ctx.herdr_config_path()
    if not os.path.exists(path):
        return None
    dest = os.path.join(ctx.state_dir(),
                        "config.backup.%s.toml" % time.strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(path, dest)
    _prune_snapshots()
    return dest


def _prune_snapshots(keep=10):
    d = ctx.state_dir()
    try:
        files = sorted(f for f in os.listdir(d)
                       if f.startswith("config.backup.") and f.endswith(".toml"))
    except OSError:
        return
    for f in files[:-keep]:
        try:
            os.remove(os.path.join(d, f))
        except OSError:
            pass


def commit(doc, path=None):
    """Validate then atomically replace the config. Raises ConfigError.

    The on-disk file is the validation baseline, so pre-existing diagnostics do
    not block the write while anything we newly introduce does.
    """
    path = path or ctx.herdr_config_path()
    text = doc.dumps()
    baseline = None
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            baseline = fh.read()
    ok, out = validate(text, baseline_text=baseline)
    if not ok:
        raise ConfigError("refusing to write invalid config: %s" % out)
    ctx.atomic_write(path, text)
    return out


# --------------------------------------------------------------------------
# backup / restore with absent-vs-present fidelity
# --------------------------------------------------------------------------

def capture_backup(doc, keys):
    out = {}
    for key in keys:
        val = doc.get(dotted(key))
        if val is MISSING:
            out[key] = {"present": False}
        else:
            out[key] = {"present": True, "value": val}
    return {"keys": out, "captured_unix": int(time.time())}


def apply_values(doc, values):
    for key, val in sorted(values.items()):
        doc.set(dotted(key), val)


SIDEBAR_TIDY_TABLES = (("ui", "sidebar", "spaces"), ("ui", "sidebar", "agents"))


def restore_backup(doc, backup, tidy_tables=(), skip=()):
    """Restore keys to exactly their recorded prior state.

    Keys named in `skip` are left as the user has them (used when a conflict was
    detected), so a manual edit is never silently discarded.

    If the parsed value already matches the backup, the key is not rewritten, so
    multi-line formatting of an already-correct live row is kept.
    """
    if not backup:
        return []
    restored = []
    skip = set(skip or ())
    for key, info in sorted((backup.get("keys") or {}).items()):
        if key in skip:
            restored.append((key, "skipped (user-modified)"))
            continue
        path = dotted(key)
        if info.get("present"):
            wanted = info.get("value")
            if doc.get(path) != wanted:
                doc.set(path, wanted)
            restored.append((key, "restored"))
        else:
            if doc.unset(path):
                restored.append((key, "removed"))
    for table in tidy_tables:
        tp = dotted(table)
        if doc.table_is_empty(tp):
            doc.remove_table(tp)
    return restored


def detect_conflicts(doc, last_written, only_keys=None):
    """Keys the user changed since the plugin last wrote them."""
    out = []
    for key, expected in sorted((last_written or {}).items()):
        if only_keys is not None and key not in only_keys:
            continue
        actual = doc.get(dotted(key))
        if actual is MISSING:
            out.append((key, expected, None))
        elif actual != expected:
            out.append((key, expected, actual))
    return out


# --------------------------------------------------------------------------
# sidebar row merging
# --------------------------------------------------------------------------

def _token_name(entry):
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        tok = entry.get("token")
        if isinstance(tok, str):
            return tok
    return None


def _bare(name):
    return (name or "").lstrip("$")


def row_has_token(rows, token):
    if not isinstance(rows, (list, tuple)):
        return False
    want = _bare(token)
    for row in rows or []:
        for entry in row or []:
            if _bare(_token_name(entry)) == want:
                return True
    return False


def has_dots(rows):
    """True if any palette slot token is already present."""
    if not isinstance(rows, (list, tuple)):
        return False
    names = {_bare(t["token"]) for t in dot_tokens()}
    for row in rows or []:
        for entry in row or []:
            if _bare(_token_name(entry)) in names:
                return True
    return False


def strip_tokens(rows, tokens):
    """Remove the named tokens (string or styled-table form) from every row."""
    want = {_bare(t) for t in tokens}
    out = []
    for row in rows or []:
        out.append([e for e in row if _bare(_token_name(e)) not in want])
    return out


def insert_tokens(rows, tokens, after="state_icon"):
    """Insert `tokens` (in order) just after `after`, else at the head of row 0.

    Idempotent, and preserves every other entry -- including inline style tables
    and unrelated tokens -- exactly.
    """
    rows = [list(r) for r in (rows or [])]
    if not rows:
        rows = [[]]
    if has_dots(rows):
        return rows
    for row in rows:
        for i, entry in enumerate(row):
            if _bare(_token_name(entry)) == after:
                row[i + 1:i + 1] = list(tokens)
                return rows
    rows[0][0:0] = list(tokens)
    return rows


def _check_limits(rows, label):
    if len(rows) > MAX_ROWS:
        raise ConfigError("%s would exceed %d rows" % (label, MAX_ROWS))
    for row in rows:
        if len(row) > MAX_TOKENS_PER_ROW:
            raise ConfigError(
                "%s would need %d tokens in one row (max %d). Reduce the palette "
                "in identity.PALETTE or shorten that row."
                % (label, len(row), MAX_TOKENS_PER_ROW))


def refuse_agent_dots(rows, label):
    """Space dots plus the 15-token title row cannot share Herdr's 16-token cap."""
    if not isinstance(rows, (list, tuple)):
        return
    if has_dots(rows) and (has_title_tokens(rows) or has_agent_template(rows)):
        n = max(len(row) for row in rows) if rows else 0
        raise ConfigError(
            "%s would combine 12 space dots with the 15-token agent title row "
            "(%d tokens; Herdr max %d). Space dots stay on ui.sidebar.spaces.rows."
            % (label, n, MAX_TOKENS_PER_ROW))
    _check_limits(rows, label)


def sidebar_targets(doc):
    """Row arrays this plugin inspects.

    Spaces and agents `rows` are owned. Existing `rows_by_agent` entries are
    listed so doctor/tests can prove they are never created or rewritten.
    """
    targets = [
        (SPACES_ROWS, DEFAULT_SPACES_ROWS, "ui.sidebar.spaces.rows"),
        (AGENTS_ROWS, agent_rows_template(), "ui.sidebar.agents.rows"),
    ]
    for agent in doc.table_keys(ROWS_BY_AGENT):
        targets.append((ROWS_BY_AGENT + (agent,), None,
                        "ui.sidebar.agents.rows_by_agent.%s" % agent))
    return targets


def owned_sidebar_keys():
    return ["ui.sidebar.spaces.rows", "ui.sidebar.agents.rows"]


def current_owned_sidebar(doc):
    """Present owned sidebar values, for last_written even on idempotent install."""
    out = {}
    for key in owned_sidebar_keys():
        val = doc.get(dotted(key))
        if val is not MISSING:
            out[key] = val
    return out


def install_sidebar(doc):
    """Install owned sidebar templates. -> (backup, changes).

    Spaces keep Chromatic `$sd_*` dots. Agents get the 15-token elapsed/title/tier
    row and never receive space dots. Pre-existing `rows_by_agent` entries are
    left byte-for-byte; new ones are never created.
    """
    backup = capture_backup(doc, owned_sidebar_keys())
    changes = []

    spaces = doc.get(SPACES_ROWS)
    if spaces is MISSING:
        current = DEFAULT_SPACES_ROWS
        origin = "materialised default"
        present = False
    else:
        current = spaces
        origin = "merged"
        present = True
    if not isinstance(current, list):
        ctx.warn("ui.sidebar.spaces.rows is not a list of rows; skipping")
    else:
        cleaned = strip_tokens(current, [LEGACY_EMOJI_TOKEN])
        merged = insert_tokens(cleaned, dot_tokens())
        refuse_agent_dots(merged, "ui.sidebar.spaces.rows")
        if not present or merged != current:
            _check_limits(merged, "ui.sidebar.spaces.rows")
            doc.set(SPACES_ROWS, merged)
            changes.append(("ui.sidebar.spaces.rows", origin, merged))

    agents = doc.get(AGENTS_ROWS)
    template = agent_rows_template()
    refuse_agent_dots(template, "ui.sidebar.agents.rows")
    if agents is MISSING:
        origin = "materialised default"
        doc.set(AGENTS_ROWS, template)
        changes.append(("ui.sidebar.agents.rows", origin, template))
    elif not isinstance(agents, list):
        ctx.warn("ui.sidebar.agents.rows is not a list of rows; skipping")
    elif not has_agent_template(agents):
        # Chromatic used to inject `$sd_*` here; replace rather than stacking.
        refuse_agent_dots(template, "ui.sidebar.agents.rows")
        _check_limits(template, "ui.sidebar.agents.rows")
        doc.set(AGENTS_ROWS, template)
        changes.append(("ui.sidebar.agents.rows", "replaced", template))

    return backup, changes


def remove_sidebar(doc, backup):
    return restore_backup(doc, backup, tidy_tables=SIDEBAR_TIDY_TABLES)

# --------------------------------------------------------------------------
# keybindings ([[keys.command]] array-of-tables)
# --------------------------------------------------------------------------

KEYBIND_MARKER = "# added by iurysza.mosaic"
KEYS_COMMAND = ("keys", "command")


def find_keybind(doc, command):
    """The `[[keys.command]]` section bound to `command`, or None."""
    for sec in doc.aot_sections(KEYS_COMMAND):
        if doc.section_scalar(sec, "command") == command:
            return sec
    return None


def find_binding_for_key(doc, key):
    """The first `[[keys.command]]` whose `key` matches, or None."""
    for sec in doc.aot_sections(KEYS_COMMAND):
        if doc.section_scalar(sec, "key") == key:
            return sec
    return None


def keybind_key(doc, command):
    sec = find_keybind(doc, command)
    if not sec:
        return None
    val = doc.section_scalar(sec, "key")
    return None if val is MISSING else val


def install_keybind(doc, key, command, description):
    """Append a plugin_action keybinding. Idempotent; returns what changed.

    A binding the user already made for this command is left alone -- their key
    choice wins over ours. A key already bound to a different command is also
    left alone (bind only if free).
    """
    existing = find_keybind(doc, command)
    if existing is not None:
        current = doc.section_scalar(existing, "key")
        return ("exists", None if current is MISSING else current)
    occupied = find_binding_for_key(doc, key)
    if occupied is not None:
        other = doc.section_scalar(occupied, "command")
        return ("occupied", None if other is MISSING else other)
    doc.append_lines([
        KEYBIND_MARKER,
        "[[keys.command]]",
        'key = %s' % dump_value(key),
        'type = "plugin_action"',
        'command = %s' % dump_value(command),
        'description = %s' % dump_value(description),
    ])
    return ("added", key)


def rename_plugin_actions(doc, old_id, new_id):
    """Retarget only plugin_action commands; keep keys, comments, and descriptions."""
    records = []
    prefix = old_id + "."
    for sec in reversed(doc.aot_sections(KEYS_COMMAND)):
        command = doc.section_scalar(sec, "command")
        if (doc.section_scalar(sec, "type") != "plugin_action"
                or not isinstance(command, str) or not command.startswith(prefix)):
            continue
        key = doc.section_scalar(sec, "key")
        replacement = new_id + command[len(old_id):]
        before = list(doc.lines[sec.start:sec.end])
        doc.set_section_scalar(sec, "command", replacement)
        changed = [candidate for candidate in doc.aot_sections(KEYS_COMMAND)
                   if doc.section_scalar(candidate, "command") == replacement
                   and doc.section_scalar(candidate, "key") == key]
        if len(changed) != 1:
            raise ConfigError("ambiguous binding while migrating %s" % command)
        records.append({"key": key, "command": replacement, "before": before,
                        "after": list(doc.lines[changed[0].start:changed[0].end])})
    return records


def restore_action_renames(doc, records):
    """Restore exact migrated bodies only if the user has not edited them."""
    remaining = []
    for record in records:
        keyed = [sec for sec in doc.aot_sections(KEYS_COMMAND)
                 if doc.section_scalar(sec, "key") == record["key"]]
        if any(doc.lines[sec.start:sec.end] == record["before"] for sec in keyed):
            continue  # The config write failed, or this binding was already restored.
        matches = [sec for sec in keyed
                   if doc.section_scalar(sec, "command") == record["command"]]
        if len(matches) != 1 or doc.lines[matches[0].start:matches[0].end] != record["after"]:
            remaining.append(record)
            continue
        sec = matches[0]
        doc.lines[sec.start:sec.end] = record["before"]
        doc._reindex()
    return remaining


def remove_keybind(doc, command):
    """Remove only the binding this plugin added for `command`."""
    sec = find_keybind(doc, command)
    if sec is None:
        return False
    doc.remove_section(sec)
    return True
