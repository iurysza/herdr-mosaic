import { readFileSync } from "node:fs"

import { TomlEditError } from "../runtime/errors.ts"

export const MISSING = Symbol("toml-missing")

export type Missing = typeof MISSING

export class RawToml {
  constructor(readonly raw: string) {}
}

export class TomlTable {
  readonly entries: Array<[string, TomlValue]>

  constructor(entries: Iterable<readonly [string, TomlValue]> = []) {
    this.entries = []

    for (const entry of entries) {
      this.entries.push([entry[0], entry[1]])
    }
  }

  get(key: string): TomlValue | undefined {
    for (const entry of this.entries) {
      if (entry[0] === key) return entry[1]
    }

    return undefined
  }

  set(key: string, value: TomlValue): void {
    for (let i = 0; i < this.entries.length; i++) {
      const pair = this.entries[i]

      if (pair !== undefined && pair[0] === key) {
        this.entries[i] = [key, value]

        return
      }
    }

    this.entries.push([key, value])
  }

  toJSON() {
    return Object.fromEntries(this.entries)
  }

  childTable(key: string): TomlTable {
    const existing = this.get(key)

    if (existing instanceof TomlTable) return existing

    const nested = new TomlTable()

    this.set(key, nested)

    return nested
  }
}

export type TomlValue =
  | string
  | number
  | boolean
  | RawToml
  | TomlList
  | TomlTable

export type TomlList = TomlValue[]

export type TomlKeyPath = readonly string[]

export type TomlSection = {
  path: TomlKeyPath
  headerIdx: number
  start: number
  end: number
  isAot: boolean
}

const HEADER_RE = /^\s*\[(\[?)\s*(.*?)\s*(\]?)\]\s*(#.*)?$/

const BARE_KEY_RE = /^[A-Za-z0-9_-]+/

const BARE_KEY_FULL_RE = /^[A-Za-z0-9_-]+$/

const TOKEN_RE = /^[^,\]}\s#]+/

const INT_RE = /^[+-]?[0-9_]+$/

const FLOAT_RE = /^[+-]?[0-9_]*\.?[0-9_]+([eE][+-]?[0-9_]+)?$/

function fail(message: string): never {
  throw new TomlEditError({ message })
}

export function isMissing(value: TomlValue | Missing): value is Missing {
  return value === MISSING
}

export function isRawToml(value: TomlValue): value is RawToml {
  return value instanceof RawToml
}

export function isTomlList(value: TomlValue | Missing | undefined): value is TomlList {
  return Array.isArray(value)
}

export function isTomlTable(value: TomlValue): value is TomlTable {
  return value instanceof TomlTable
}

export function isTomlString(value: TomlValue | undefined): value is string {
  return value !== undefined && Object.prototype.toString.call(value) === "[object String]"
}

function isTomlNumber(value: TomlValue): value is number {
  return Object.prototype.toString.call(value) === "[object Number]"
}

function dumpEscape(ch: string): string | undefined {
  if (ch === "\\") return "\\\\"

  if (ch === '"') return '\\"'

  if (ch === "\n") return "\\n"

  if (ch === "\t") return "\\t"

  if (ch === "\r") return "\\r"

  return undefined
}

function parseEscape(ch: string): string {
  if (ch === "n") return "\n"

  if (ch === "t") return "\t"

  if (ch === "r") return "\r"

  if (ch === '"') return '"'

  if (ch === "\\") return "\\"

  if (ch === "0") return "\0"

  return ch
}

function pythonSplitLines(text: string): string[] {
  const lines: string[] = []
  let start = 0

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)

    const isBreak = code === 10
      || code === 13
      || code === 11
      || code === 12
      || code === 0x1c
      || code === 0x1d
      || code === 0x1e
      || code === 0x85
      || code === 0x2028
      || code === 0x2029

    if (!isBreak) continue

    lines.push(text.slice(start, i))

    if (code === 13 && text.charCodeAt(i + 1) === 10) i += 1

    start = i + 1
  }

  if (start < text.length) lines.push(text.slice(start))

  return lines
}

function countNeedle(haystack: string, needle: string): number {
  if (needle === "") return 0

  let count = 0
  let pos = 0

  while (pos <= haystack.length) {
    const found = haystack.indexOf(needle, pos)

    if (found < 0) return count

    count += 1
    pos = found + needle.length
  }

  return count
}

function pathsEqual(left: TomlKeyPath, right: TomlKeyPath): boolean {
  if (left.length !== right.length) return false

  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }

  return true
}

export function tomlEqual(left: TomlValue | Missing, right: TomlValue | Missing): boolean {
  if (left === MISSING || right === MISSING) return left === right

  if (left instanceof RawToml || right instanceof RawToml) {
    return left instanceof RawToml && right instanceof RawToml && left.raw === right.raw
  }

  if (left === true || left === false || right === true || right === false) {
    return left === right
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false

    if (left.length !== right.length) return false

    for (let i = 0; i < left.length; i++) {
      const a = left[i]
      const b = right[i]

      if (a === undefined || b === undefined || !tomlEqual(a, b)) return false
    }

    return true
  }

  if (Number.isFinite(left) || Number.isFinite(right)) return left === right

  if (left instanceof TomlTable && right instanceof TomlTable) {
    if (left.entries.length !== right.entries.length) return false

    for (const entry of left.entries) {
      const other = right.get(entry[0])

      if (other === undefined || !tomlEqual(entry[1], other)) return false
    }

    return true
  }

  return left === right
}

function readQuoted(text: string, start: number): readonly [string, number] {
  const quote = text[start]

  if (quote === undefined) fail("unterminated string")

  if (text.startsWith(quote.repeat(3), start)) {
    const end = text.indexOf(quote.repeat(3), start + 3)

    if (end < 0) fail("unterminated multi-line string")

    return [text.slice(start + 3, end), end + 3]
  }

  const out: string[] = []
  let i = start + 1

  while (i < text.length) {
    const ch = text[i]

    if (ch === undefined) break

    if (ch === "\\" && quote === '"') {
      const nxt = text[i + 1] ?? ""

      out.push(parseEscape(nxt))
      i += 2
      continue
    }

    if (ch === quote) return [out.join(""), i + 1]

    out.push(ch)
    i += 1
  }

  return fail("unterminated string")
}

export function splitKeyPath(text: string): string[] {
  const parts: string[] = []
  let i = 0
  const n = text.length

  while (i < n) {
    while (i < n && (text[i] === " " || text[i] === "\t")) i += 1

    if (i >= n) break

    const ch = text[i]

    if (ch === '"' || ch === "'") {
      const quoted = readQuoted(text, i)

      parts.push(quoted[0])
      i = quoted[1]
    } else {
      const rest = text.slice(i)
      const matched = BARE_KEY_RE.exec(rest)

      if (matched === null) fail(`cannot parse key path ${JSON.stringify(text)} at ${i}`)

      parts.push(matched[0])
      i += matched[0].length
    }

    while (i < n && (text[i] === " " || text[i] === "\t")) i += 1

    if (i < n) {
      if (text[i] !== ".") fail(`cannot parse key path ${JSON.stringify(text)} at ${i}`)

      i += 1
    }
  }

  if (parts.length === 0) fail(`empty key path ${JSON.stringify(text)}`)

  return parts
}

export function quoteKey(part: string): string {
  if (BARE_KEY_FULL_RE.test(part)) return part

  return dumpValue(part)
}

export function renderKeyPath(path: TomlKeyPath): string {
  return path.map(quoteKey).join(".")
}

export function scanValueEnd(text: string, start: number): number {
  let i = start
  let depth = 0
  const n = text.length

  while (i < n) {
    const c = text[i]

    if (c === '"' || c === "'") {
      if (c !== undefined && text.startsWith(c.repeat(3), i)) {
        const end = text.indexOf(c.repeat(3), i + 3)

        if (end < 0) fail("unterminated multi-line string")

        i = end + 3
        continue
      }

      const quoted = readQuoted(text, i)

      i = quoted[1]
      continue
    }

    if (c === "[" || c === "{") {
      depth += 1
      i += 1
      continue
    }

    if (c === "]" || c === "}") {
      depth -= 1
      i += 1

      if (depth <= 0) return i

      continue
    }

    if (c === "#" && depth === 0) return i

    if (c === "\n" && depth === 0) return i

    i += 1
  }

  return n
}

function skipWs(text: string, start: number): number {
  let i = start
  const n = text.length

  while (i < n) {
    const c = text[i]

    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i += 1
    } else if (c === "#") {
      const j = text.indexOf("\n", i)

      i = j < 0 ? n : j + 1
    } else {
      break
    }
  }

  return i
}

function stripWsComments(text: string, start: number): number {
  let i = start
  const n = text.length

  while (i < n) {
    const c = text[i]

    if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === ",") {
      i += 1
    } else if (c === "#") {
      const j = text.indexOf("\n", i)

      i = j < 0 ? n : j + 1
    } else {
      break
    }
  }

  return i
}

function parseArray(text: string, start: number): readonly [TomlList, number] {
  if (text[start] !== "[") fail("unterminated array")

  let i = start + 1
  const out: TomlList = []

  while (true) {
    i = skipWs(text, i)

    if (i >= text.length) fail("unterminated array")

    if (text[i] === "]") return [out, i + 1]

    const parsed = parseValueAt(text, i)

    out.push(parsed[0])
    i = skipWs(text, parsed[1])

    if (i < text.length && text[i] === ",") i += 1
  }
}

function parseInlineTable(text: string, start: number): readonly [TomlTable, number] {
  if (text[start] !== "{") fail("unterminated inline table")

  let i = start + 1
  const out = new TomlTable()

  while (true) {
    i = skipWs(text, i)

    if (i >= text.length) fail("unterminated inline table")

    if (text[i] === "}") return [out, i + 1]

    const eq = text.indexOf("=", i)

    if (eq < 0) fail("inline table missing '='")

    const key = splitKeyPath(text.slice(i, eq).trim())
    const parsed = parseValueAt(text, eq + 1)
    let node = out

    for (const part of key.slice(0, -1)) {
      node = node.childTable(part)
    }

    const last = key[key.length - 1]

    if (last === undefined) fail("inline table missing '='")

    node.set(last, parsed[0])
    i = skipWs(text, parsed[1])

    if (i < text.length && text[i] === ",") i += 1
  }
}

function parseValueAt(text: string, start: number): readonly [TomlValue, number] {
  const i = skipWs(text, start)

  if (i >= text.length) fail("empty value")

  const c = text[i]

  if (c === '"' || c === "'") return readQuoted(text, i)

  if (c === "[") return parseArray(text, i)

  if (c === "{") return parseInlineTable(text, i)

  const matched = TOKEN_RE.exec(text.slice(i))

  if (matched === null) fail(`cannot parse value at ${i} in ${JSON.stringify(text)}`)

  const tok = matched[0]
  const end = i + tok.length

  if (tok === "true") return [true, end]

  if (tok === "false") return [false, end]

  if (INT_RE.test(tok)) {
    const parsed = Number.parseInt(tok.replaceAll("_", ""), 10)

    if (!Number.isNaN(parsed)) return [parsed, end]
  }

  if (FLOAT_RE.test(tok)) {
    const parsed = Number.parseFloat(tok.replaceAll("_", ""))

    if (!Number.isNaN(parsed)) return [parsed, end]
  }

  return [new RawToml(tok), end]
}

export function parseValue(text: string): TomlValue {
  const parsed = parseValueAt(text, 0)
  const rest = stripWsComments(text, parsed[1])

  if (rest !== text.length) fail(`trailing content in value ${JSON.stringify(text)}`)

  return parsed[0]
}

function dumpFloat(value: number): string {
  if (Number.isInteger(value) && !Object.is(value, -0)) return String(value)

  const repr = String(value)

  if (repr.includes("e") || repr.includes("E") || repr.includes(".")) return repr

  return `${repr}.0`
}

export function dumpValue(value: TomlValue): string {
  if (value instanceof RawToml) return value.raw

  if (value === true) return "true"

  if (value === false) return "false"

  if (isTomlString(value)) {
    const out = ['"']

    for (const ch of value) {
      const escaped = dumpEscape(ch)

      if (escaped !== undefined) {
        out.push(escaped)
      } else if (ch.charCodeAt(0) < 0x20) {
        const hex = ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")

        out.push(`\\u${hex}`)
      } else {
        out.push(ch)
      }
    }

    out.push('"')

    return out.join("")
  }

  if (isTomlNumber(value)) return dumpFloat(value)

  if (Array.isArray(value)) {
    return `[${value.map(dumpValue).join(", ")}]`
  }

  if (value instanceof TomlTable) {
    const parts: string[] = []

    for (const entry of value.entries) {
      parts.push(`${quoteKey(entry[0])} = ${dumpValue(entry[1])}`)
    }

    return `{${parts.join(", ")}}`
  }

  return fail(`cannot serialize ${String(value)}`)
}

function findEq(line: string): number {
  let i = 0
  const n = line.length

  while (i < n) {
    const c = line[i]

    if (c === '"' || c === "'") {
      try {
        i = readQuoted(line, i)[1]
      } catch (error) {
        if (error instanceof TomlEditError) return -1

        throw error
      }

      continue
    }

    if (c === "#") return -1

    if (c === "=") return i

    if (c === "[" || c === "{") return -1

    i += 1
  }

  return -1
}

export class TomlDoc {
  readonly _nl: string
  readonly _trailingNl: boolean
  lines: string[]
  sections: TomlSection[] = []

  constructor(text: string) {
    this._nl = text.includes("\r\n") ? "\r\n" : "\n"
    this._trailingNl = text.endsWith("\n") || text.endsWith("\r")
    this.lines = pythonSplitLines(text)
    this.reindex()
  }

  static load(path: string): TomlDoc {
    return new TomlDoc(readFileSync(path, "utf8"))
  }

  dumps(): string {
    let out = this.lines.join(this._nl)

    if (this._trailingNl && !out.endsWith(this._nl)) out += this._nl

    return out
  }

  reindex(): void {
    const pending: TomlSection[] = []

    let cur: TomlSection = {
      path: [],
      headerIdx: -1,
      start: 0,
      end: this.lines.length,
      isAot: false,
    }

    let i = 0

    while (i < this.lines.length) {
      const line = this.lines[i] ?? ""
      const matched = HEADER_RE.exec(line)

      if (matched !== null && (matched[1] === "") === (matched[3] === "")) {
        cur.end = i
        pending.push(cur)

        const isAot = matched[1] === "["
        let path: string[]

        try {
          path = splitKeyPath(matched[2] ?? "")
        } catch (error) {
          if (error instanceof TomlEditError) path = [matched[2] ?? ""]
          else throw error
        }

        cur = {
          path,
          headerIdx: i,
          start: i + 1,
          end: this.lines.length,
          isAot,
        }
      } else {
        const span = this.valueSpanAt(i)

        if (span !== undefined) {
          i = span[1]
          continue
        }
      }

      i += 1
    }

    cur.end = this.lines.length
    pending.push(cur)
    this.sections = pending
  }

  valueSpanAt(idx: number): readonly [number, number] | undefined {
    const line = this.lines[idx]

    if (line === undefined) return undefined

    const stripped = line.trim()

    if (stripped === "" || stripped.startsWith("#")) return undefined

    const eq = findEq(line)

    if (eq < 0) return undefined

    const joined = this.lines.slice(idx).join(this._nl)
    const offset = line.slice(0, eq + 1).length

    try {
      const endOff = scanValueEnd(joined, offset)
      const consumed = joined.slice(0, endOff)

      return [idx, idx + countNeedle(consumed, this._nl) + 1]
    } catch (error) {
      if (error instanceof TomlEditError) return undefined

      throw error
    }
  }

  sectionsFor(path: TomlKeyPath): TomlSection[] {
    const wanted = [...path]
    const out: TomlSection[] = []

    for (const section of this.sections) {
      if (!section.isAot && pathsEqual(section.path, wanted)) out.push(section)
    }

    return out
  }

  findKey(
    path: TomlKeyPath,
  ): readonly [TomlSection, number, number, number] | undefined {
    const parts = [...path]

    for (let i = parts.length - 1; i >= 0; i--) {
      const table = parts.slice(0, i)
      const keyrest = parts.slice(i)

      for (const section of this.sectionsFor(table)) {
        const hit = this.scanSectionForKey(section, keyrest)

        if (hit !== undefined) return hit
      }
    }

    return undefined
  }

  scanSectionForKey(
    section: TomlSection,
    keyrest: TomlKeyPath,
  ): readonly [TomlSection, number, number, number] | undefined {
    let idx = section.start

    while (idx < section.end) {
      const span = this.valueSpanAt(idx)

      if (span === undefined) {
        idx += 1
        continue
      }

      const line = this.lines[idx] ?? ""
      const eq = findEq(line)

      try {
        const got = splitKeyPath(line.slice(0, eq).trim())

        if (pathsEqual(got, keyrest)) return [section, span[0], span[1], eq]
      } catch (error) {
        if (!(error instanceof TomlEditError)) throw error
      }

      idx = span[1]
    }

    return undefined
  }

  get(path: TomlKeyPath): TomlValue | Missing {
    const hit = this.findKey(path)

    if (hit === undefined) return MISSING

    const start = hit[1]
    const end = hit[2]
    const eq = hit[3]
    const chunk = this.lines.slice(start, end).join(this._nl)
    const raw = chunk.slice(eq + 1)
    const endOff = scanValueEnd(raw, 0)

    return parseValue(raw.slice(0, endOff).trim())
  }

  has(path: TomlKeyPath): boolean {
    return this.findKey(path) !== undefined
  }

  set(path: TomlKeyPath, value: TomlValue): void {
    const parts = [...path]
    const rendered = dumpValue(value)
    const hit = this.findKey(parts)

    if (hit !== undefined) {
      const start = hit[1]
      const end = hit[2]
      const eq = hit[3]
      const line = this.lines[start] ?? ""
      const indent = line.slice(0, line.length - line.trimStart().length)
      const keyText = line.slice(indent.length, eq).trimEnd()
      const chunk = this.lines.slice(start, end).join(this._nl)
      const raw = chunk.slice(eq + 1)
      const endOff = scanValueEnd(raw, 0)
      const trailer = raw.slice(endOff).trim()
      let next = `${indent}${keyText} = ${rendered}`

      if (trailer.startsWith("#")) next += `  ${trailer}`

      this.lines.splice(start, end - start, next)
      this.reindex()

      return
    }

    const parent = parts.slice(0, -1)
    const key = parts.slice(-1)
    const secs = parent.length > 0 ? this.sectionsFor(parent) : this.sectionsFor([])

    if (secs.length > 0) {
      const section = secs[secs.length - 1]

      if (section === undefined) return

      let insertAt = section.end

      while (insertAt > section.start && !(this.lines[insertAt - 1] ?? "").trim()) {
        insertAt -= 1
      }

      this.lines.splice(insertAt, 0, `${renderKeyPath(key)} = ${rendered}`)
      this.reindex()

      return
    }

    const block: string[] = []

    if (this.lines.length > 0 && (this.lines[this.lines.length - 1] ?? "").trim()) {
      block.push("")
    }

    if (parent.length > 0) {
      block.push(`[${renderKeyPath(parent)}]`)
      block.push(`${renderKeyPath(key)} = ${rendered}`)
    } else {
      block.push(`${renderKeyPath(parts)} = ${rendered}`)
    }

    this.lines.push(...block)
    this.reindex()
  }

  unset(path: TomlKeyPath): boolean {
    const hit = this.findKey(path)

    if (hit === undefined) return false

    const start = hit[1]
    const end = hit[2]

    this.lines.splice(start, end - start)
    this.reindex()

    return true
  }

  tableIsEmpty(path: TomlKeyPath): boolean {
    const secs = this.sectionsFor(path)

    if (secs.length === 0) return false

    const prefix = [...path]

    for (const section of this.sections) {
      if (
        section.path.length > prefix.length
        && pathsEqual(section.path.slice(0, prefix.length), prefix)
      ) {
        return false
      }
    }

    for (const section of secs) {
      let idx = section.start

      while (idx < section.end) {
        if (this.valueSpanAt(idx) !== undefined) return false

        idx += 1
      }
    }

    return true
  }

  aotSections(path: TomlKeyPath): TomlSection[] {
    const wanted = [...path]
    const out: TomlSection[] = []

    for (const section of this.sections) {
      if (section.isAot && pathsEqual(section.path, wanted)) out.push(section)
    }

    return out
  }

  sectionScalar(section: TomlSection, key: string): TomlValue | Missing {
    const hit = this.scanSectionForKey(section, [key])

    if (hit === undefined) return MISSING

    const start = hit[1]
    const end = hit[2]
    const eq = hit[3]
    const chunk = this.lines.slice(start, end).join(this._nl)
    const raw = chunk.slice(eq + 1)

    return parseValue(raw.slice(0, scanValueEnd(raw, 0)).trim())
  }

  setSectionScalar(section: TomlSection, key: string, value: TomlValue): void {
    const hit = this.scanSectionForKey(section, [key])

    if (hit === undefined) fail(`section has no key ${JSON.stringify(key)}`)

    const start = hit[1]
    const end = hit[2]
    const eq = hit[3]
    const chunk = this.lines.slice(start, end).join(this._nl)
    const raw = chunk.slice(eq + 1)
    const valueEnd = scanValueEnd(raw, 0)
    const old = raw.slice(0, valueEnd)
    const leading = old.slice(0, old.length - old.trimStart().length)
    const trailing = old.slice(old.trimEnd().length)

    this.lines.splice(
      start,
      end - start,
      chunk.slice(0, eq + 1) + leading + dumpValue(value) + trailing + raw.slice(valueEnd),
    )
    this.reindex()
  }

  appendLines(lines: readonly string[]): void {
    if (this.lines.length > 0 && (this.lines[this.lines.length - 1] ?? "").trim()) {
      this.lines.push("")
    }

    this.lines.push(...lines)
    this.reindex()
  }

  removeSection(section: TomlSection, stripCommentPrefix = true): void {
    let start = section.headerIdx

    if (stripCommentPrefix) {
      while (start > 0 && (this.lines[start - 1] ?? "").trim().startsWith("#")) {
        start -= 1
      }
    }

    while (start > 0 && !(this.lines[start - 1] ?? "").trim()) {
      start -= 1
    }

    this.lines.splice(start, section.end - start)
    this.reindex()
  }

  tableKeys(path: TomlKeyPath): string[] {
    const out: string[] = []

    for (const section of this.sectionsFor(path)) {
      let idx = section.start

      while (idx < section.end) {
        const span = this.valueSpanAt(idx)

        if (span === undefined) {
          idx += 1
          continue
        }

        const line = this.lines[idx] ?? ""
        const eq = findEq(line)

        try {
          const key = splitKeyPath(line.slice(0, eq).trim())

          if (key.length === 1 && key[0] !== undefined && !out.includes(key[0])) {
            out.push(key[0])
          }
        } catch (error) {
          if (!(error instanceof TomlEditError)) throw error
        }

        idx = span[1]
      }
    }

    return out
  }

  removeTable(path: TomlKeyPath): boolean {
    const secs = this.sectionsFor(path)

    if (secs.length === 0) return false

    let removed = false

    for (const section of [...secs].reverse()) {
      let start = section.headerIdx
      const end = section.end

      while (start > 0 && !(this.lines[start - 1] ?? "").trim()) {
        start -= 1
      }

      this.lines.splice(start, end - start)
      removed = true
    }

    this.reindex()

    return removed
  }
}
