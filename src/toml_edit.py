"""Surgical, comment-preserving TOML editing.

Only the byte ranges belonging to keys we explicitly target are rewritten; every
other line -- comments, blank lines, ordering, unrelated tables -- is passed
through untouched. Herdr 0.8.0 ships no TOML round-trip library we can rely on
(the system interpreter is 3.9, so there is no `tomllib`), and rewriting the
file from a parsed model would drop the user's comments. Hence this module.

Scope is deliberately narrow: scalars and (possibly nested) arrays inside
`[table]` headers or as root/dotted keys. Anything we cannot interpret with
confidence raises `TomlEditError` instead of guessing -- a refusal to write is
always safer than a corrupted config.
"""

import re

MISSING = object()

_HEADER_RE = re.compile(r'^\s*\[(\[?)\s*(.*?)\s*(\]?)\]\s*(#.*)?$')
_BARE_KEY = re.compile(r'[A-Za-z0-9_-]+')


class TomlEditError(Exception):
    pass


# --------------------------------------------------------------------------
# key paths
# --------------------------------------------------------------------------

def split_key_path(text):
    """Split a dotted TOML key into its parts, honouring quoted segments."""
    parts = []
    i = 0
    n = len(text)
    while i < n:
        while i < n and text[i] in ' \t':
            i += 1
        if i >= n:
            break
        ch = text[i]
        if ch in '"\'':
            val, i = _read_quoted(text, i)
            parts.append(val)
        else:
            m = _BARE_KEY.match(text, i)
            if not m:
                raise TomlEditError("cannot parse key path %r at %d" % (text, i))
            parts.append(m.group(0))
            i = m.end()
        while i < n and text[i] in ' \t':
            i += 1
        if i < n:
            if text[i] != '.':
                raise TomlEditError("cannot parse key path %r at %d" % (text, i))
            i += 1
    if not parts:
        raise TomlEditError("empty key path %r" % (text,))
    return tuple(parts)


def _read_quoted(text, i):
    q = text[i]
    if text.startswith(q * 3, i):
        end = text.find(q * 3, i + 3)
        if end < 0:
            raise TomlEditError("unterminated multi-line string")
        return text[i + 3:end], end + 3
    out = []
    i += 1
    while i < len(text):
        c = text[i]
        if c == '\\' and q == '"':
            nxt = text[i + 1] if i + 1 < len(text) else ''
            out.append({'n': '\n', 't': '\t', 'r': '\r', '"': '"',
                        '\\': '\\', '0': '\0'}.get(nxt, nxt))
            i += 2
            continue
        if c == q:
            return ''.join(out), i + 1
        out.append(c)
        i += 1
    raise TomlEditError("unterminated string")


def quote_key(part):
    if _BARE_KEY.fullmatch(part):
        return part
    return dump_value(part)


def render_key_path(path):
    return '.'.join(quote_key(p) for p in path)


# --------------------------------------------------------------------------
# value scanning / parsing / dumping
# --------------------------------------------------------------------------

def scan_value_end(text, start):
    """Return the index just past the TOML value beginning at `start`.

    Tracks string and bracket state so multi-line arrays and inline tables are
    consumed whole, and so `#` inside a string is not mistaken for a comment.
    """
    i = start
    depth = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c in '"\'':
            if text.startswith(c * 3, i):
                end = text.find(c * 3, i + 3)
                if end < 0:
                    raise TomlEditError("unterminated multi-line string")
                i = end + 3
                continue
            _, i = _read_quoted(text, i)
            continue
        if c in '[{':
            depth += 1
            i += 1
            continue
        if c in ']}':
            depth -= 1
            i += 1
            if depth <= 0:
                return i
            continue
        if c == '#' and depth == 0:
            return i
        if c == '\n' and depth == 0:
            return i
        i += 1
    return n


def parse_value(text):
    val, i = _parse_value(text, 0)
    rest = _strip_ws_comments(text, i)
    if rest != len(text):
        raise TomlEditError("trailing content in value %r" % (text,))
    return val


def _strip_ws_comments(text, i):
    n = len(text)
    while i < n:
        c = text[i]
        if c in ' \t\r\n,':
            i += 1
        elif c == '#':
            j = text.find('\n', i)
            i = n if j < 0 else j + 1
        else:
            break
    return i


def _parse_value(text, i):
    i = _skip_ws(text, i)
    if i >= len(text):
        raise TomlEditError("empty value")
    c = text[i]
    if c in '"\'':
        return _read_quoted(text, i)
    if c == '[':
        return _parse_array(text, i)
    if c == '{':
        return _parse_inline_table(text, i)
    m = re.match(r'[^,\]\}\s#]+', text[i:])
    if not m:
        raise TomlEditError("cannot parse value at %d in %r" % (i, text))
    tok = m.group(0)
    end = i + len(tok)
    if tok == 'true':
        return True, end
    if tok == 'false':
        return False, end
    try:
        if re.fullmatch(r'[+-]?[0-9_]+', tok):
            return int(tok.replace('_', ''), 10), end
        if re.fullmatch(r'[+-]?[0-9_]*\.?[0-9_]+([eE][+-]?[0-9_]+)?', tok):
            return float(tok.replace('_', '')), end
    except ValueError:
        pass
    return RawToml(tok), end


class RawToml(str):
    """A value we round-trip verbatim (dates, times, odd numeric forms)."""
    __slots__ = ()


def _skip_ws(text, i):
    n = len(text)
    while i < n:
        if text[i] in ' \t\r\n':
            i += 1
        elif text[i] == '#':
            j = text.find('\n', i)
            i = n if j < 0 else j + 1
        else:
            break
    return i


def _parse_array(text, i):
    assert text[i] == '['
    i += 1
    out = []
    while True:
        i = _skip_ws(text, i)
        if i >= len(text):
            raise TomlEditError("unterminated array")
        if text[i] == ']':
            return out, i + 1
        val, i = _parse_value(text, i)
        out.append(val)
        i = _skip_ws(text, i)
        if i < len(text) and text[i] == ',':
            i += 1


def _parse_inline_table(text, i):
    assert text[i] == '{'
    i += 1
    out = {}
    while True:
        i = _skip_ws(text, i)
        if i >= len(text):
            raise TomlEditError("unterminated inline table")
        if text[i] == '}':
            return out, i + 1
        j = text.find('=', i)
        if j < 0:
            raise TomlEditError("inline table missing '='")
        key = split_key_path(text[i:j].strip())
        val, i = _parse_value(text, j + 1)
        node = out
        for p in key[:-1]:
            node = node.setdefault(p, {})
        node[key[-1]] = val
        i = _skip_ws(text, i)
        if i < len(text) and text[i] == ',':
            i += 1


_ESCAPES = {'\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r'}


def dump_value(val):
    if isinstance(val, RawToml):
        return str(val)
    if isinstance(val, bool):
        return 'true' if val else 'false'
    if isinstance(val, str):
        out = ['"']
        for ch in val:
            if ch in _ESCAPES:
                out.append(_ESCAPES[ch])
            elif ord(ch) < 0x20:
                out.append('\\u%04X' % ord(ch))
            else:
                out.append(ch)
        out.append('"')
        return ''.join(out)
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        return repr(val)
    if isinstance(val, (list, tuple)):
        return '[' + ', '.join(dump_value(v) for v in val) + ']'
    if isinstance(val, dict):
        return '{' + ', '.join(
            '%s = %s' % (quote_key(k), dump_value(v)) for k, v in val.items()) + '}'
    raise TomlEditError("cannot serialize %r" % (val,))


# --------------------------------------------------------------------------
# document
# --------------------------------------------------------------------------

class _Section(object):
    __slots__ = ('path', 'header_idx', 'start', 'end', 'is_aot')

    def __init__(self, path, header_idx, start, end, is_aot):
        self.path = path
        self.header_idx = header_idx
        self.start = start
        self.end = end
        self.is_aot = is_aot


class TomlDoc(object):
    """A line-oriented view of a TOML file supporting targeted edits."""

    def __init__(self, text):
        self._nl = '\r\n' if '\r\n' in text else '\n'
        self._trailing_nl = text.endswith(('\n', '\r'))
        self.lines = text.splitlines()
        self._reindex()

    @classmethod
    def load(cls, path):
        with open(path, 'r', encoding='utf-8') as fh:
            return cls(fh.read())

    def dumps(self):
        out = self._nl.join(self.lines)
        if self._trailing_nl and not out.endswith(self._nl):
            out += self._nl
        return out

    # -- indexing ---------------------------------------------------------
    def _reindex(self):
        self.sections = []
        cur = _Section((), -1, 0, len(self.lines), False)
        pending = []
        i = 0
        while i < len(self.lines):
            line = self.lines[i]
            m = _HEADER_RE.match(line)
            if m and (m.group(1) == '') == (m.group(3) == ''):
                cur.end = i
                pending.append(cur)
                is_aot = m.group(1) == '['
                try:
                    path = split_key_path(m.group(2))
                except TomlEditError:
                    path = (m.group(2),)
                cur = _Section(path, i, i + 1, len(self.lines), is_aot)
            else:
                # skip over multi-line values so a bracket inside them is not
                # mistaken for a table header
                span = self._value_span_at(i)
                if span is not None:
                    i = span[1]
                    continue
            i += 1
        cur.end = len(self.lines)
        pending.append(cur)
        self.sections = pending

    def _value_span_at(self, idx):
        """If line `idx` starts a `key = value`, return (start_idx, end_idx)."""
        line = self.lines[idx]
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            return None
        eq = self._find_eq(line)
        if eq < 0:
            return None
        joined = self._nl.join(self.lines[idx:])
        offset = len(line[:eq + 1])
        try:
            end_off = scan_value_end(joined, offset)
        except TomlEditError:
            return None
        consumed = joined[:end_off]
        return (idx, idx + consumed.count(self._nl) + 1)

    @staticmethod
    def _find_eq(line):
        i = 0
        n = len(line)
        while i < n:
            c = line[i]
            if c in '"\'':
                try:
                    _, i = _read_quoted(line, i)
                except TomlEditError:
                    return -1
                continue
            if c == '#':
                return -1
            if c == '=':
                return i
            if c in '[{':
                return -1
            i += 1
        return -1

    # -- lookup -----------------------------------------------------------
    def _sections_for(self, path):
        return [s for s in self.sections if s.path == tuple(path) and not s.is_aot]

    def find_key(self, path):
        """Locate `path`, returning (section, start_line, end_line, eq_col).

        Tries every split of the dotted path so `[ui.sidebar.spaces] rows`,
        `[ui] sidebar.spaces.rows` and a bare root `ui.sidebar.spaces.rows` all
        resolve. Returns None when the key is absent.
        """
        path = tuple(path)
        for i in range(len(path) - 1, -1, -1):
            table, keyrest = path[:i], path[i:]
            for sec in self._sections_for(table):
                hit = self._scan_section_for_key(sec, keyrest)
                if hit:
                    return hit
        return None

    def _scan_section_for_key(self, sec, keyrest):
        idx = sec.start
        while idx < sec.end:
            span = self._value_span_at(idx)
            if span is None:
                idx += 1
                continue
            line = self.lines[idx]
            eq = self._find_eq(line)
            try:
                got = split_key_path(line[:eq].strip())
            except TomlEditError:
                idx = span[1]
                continue
            if got == tuple(keyrest):
                return (sec, span[0], span[1], eq)
            idx = span[1]
        return None

    def get(self, path):
        hit = self.find_key(path)
        if not hit:
            return MISSING
        _, start, end, eq = hit
        chunk = self._nl.join(self.lines[start:end])
        raw = chunk[eq + 1:]
        end_off = scan_value_end(raw, 0)
        return parse_value(raw[:end_off].strip())

    def has(self, path):
        return self.find_key(path) is not None

    # -- mutation ---------------------------------------------------------
    def set(self, path, value):
        path = tuple(path)
        hit = self.find_key(path)
        rendered = dump_value(value)
        if hit:
            _, start, end, eq = hit
            line = self.lines[start]
            indent = line[:len(line) - len(line.lstrip())]
            key_text = line[len(indent):eq].rstrip()
            chunk = self._nl.join(self.lines[start:end])
            raw = chunk[eq + 1:]
            end_off = scan_value_end(raw, 0)
            trailer = raw[end_off:].strip()
            new = '%s%s = %s' % (indent, key_text, rendered)
            if trailer.startswith('#'):
                new += '  ' + trailer
            self.lines[start:end] = [new]
            self._reindex()
            return
        # absent: prefer inserting into the key's immediate parent table, so we
        # produce an explicit `[a.b]` header rather than a dotted key hidden in
        # a grandparent table (predictable to read, and to remove again later).
        parent, key = path[:-1], path[-1:]
        secs = self._sections_for(parent) if parent else self._sections_for(())
        if secs:
            sec = secs[-1]
            insert_at = sec.end
            while insert_at > sec.start and not self.lines[insert_at - 1].strip():
                insert_at -= 1
            self.lines.insert(
                insert_at, '%s = %s' % (render_key_path(key), rendered))
            self._reindex()
            return
        # parent table does not exist: append a fresh one at EOF
        table = parent
        block = []
        if self.lines and self.lines[-1].strip():
            block.append('')
        if table:
            block.append('[%s]' % render_key_path(table))
            block.append('%s = %s' % (render_key_path(key), rendered))
        else:
            block.append('%s = %s' % (render_key_path(path), rendered))
        self.lines.extend(block)
        self._reindex()

    def unset(self, path):
        hit = self.find_key(path)
        if not hit:
            return False
        _, start, end, _ = hit
        del self.lines[start:end]
        self._reindex()
        return True

    def table_is_empty(self, path):
        secs = self._sections_for(path)
        if not secs:
            return False
        prefix = tuple(path)
        for s in self.sections:
            if s.path[:len(prefix)] == prefix and len(s.path) > len(prefix):
                return False
        for sec in secs:
            idx = sec.start
            while idx < sec.end:
                if self._value_span_at(idx) is not None:
                    return False
                idx += 1
        return True

    def aot_sections(self, path):
        """Array-of-tables sections (`[[path]]`) for a dotted path."""
        return [s for s in self.sections if s.path == tuple(path) and s.is_aot]

    def section_scalar(self, sec, key):
        """Read a single-part key from inside one section, or MISSING."""
        hit = self._scan_section_for_key(sec, (key,))
        if not hit:
            return MISSING
        _s, start, end, eq = hit
        chunk = self._nl.join(self.lines[start:end])
        raw = chunk[eq + 1:]
        return parse_value(raw[:scan_value_end(raw, 0)].strip())

    def set_section_scalar(self, sec, key, value):
        """Replace one scalar in an array-of-tables section, not its siblings."""
        hit = self._scan_section_for_key(sec, (key,))
        if not hit:
            raise TomlEditError("section has no key %r" % key)
        _, start, end, eq = hit
        chunk = self._nl.join(self.lines[start:end])
        raw = chunk[eq + 1:]
        value_end = scan_value_end(raw, 0)
        old = raw[:value_end]
        leading = old[:len(old) - len(old.lstrip())]
        trailing = old[len(old.rstrip()):]
        self.lines[start:end] = [(chunk[:eq + 1] + leading + dump_value(value)
                                 + trailing + raw[value_end:])]
        self._reindex()

    def append_lines(self, lines):
        """Append raw lines at EOF (used for array-of-tables blocks)."""
        if self.lines and self.lines[-1].strip():
            self.lines.append('')
        self.lines.extend(lines)
        self._reindex()

    def remove_section(self, sec, strip_comment_prefix=True):
        """Delete one section header plus its body (and any comment block above)."""
        start = sec.header_idx
        if strip_comment_prefix:
            while start > 0 and self.lines[start - 1].strip().startswith('#'):
                start -= 1
        while start > 0 and not self.lines[start - 1].strip():
            start -= 1
        del self.lines[start:sec.end]
        self._reindex()

    def table_keys(self, path):
        """Direct key names defined inside `[path]` (not nested sub-tables)."""
        out = []
        for sec in self._sections_for(path):
            idx = sec.start
            while idx < sec.end:
                span = self._value_span_at(idx)
                if span is None:
                    idx += 1
                    continue
                line = self.lines[idx]
                eq = self._find_eq(line)
                try:
                    key = split_key_path(line[:eq].strip())
                except TomlEditError:
                    idx = span[1]
                    continue
                if len(key) == 1 and key[0] not in out:
                    out.append(key[0])
                idx = span[1]
        return out

    def remove_table(self, path):
        secs = self._sections_for(path)
        if not secs:
            return False
        removed = False
        for sec in reversed(secs):
            start = sec.header_idx
            end = sec.end
            while start > 0 and not self.lines[start - 1].strip():
                start -= 1
            del self.lines[start:end]
            removed = True
        self._reindex()
        return removed
