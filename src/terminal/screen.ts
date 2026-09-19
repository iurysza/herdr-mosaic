export type Attr = {
  readonly bold?: boolean
  readonly dim?: boolean
  readonly reverse?: boolean
  readonly fg?: string
}

export type Cell = {
  ch: string
  attr: Attr
}

export type Screen = {
  readonly rows: number
  readonly cols: number
  readonly cells: Cell[][]
}

const EMPTY: Attr = {}

export function emptyScreen(rows: number, cols: number): Screen {
  const height = Math.max(1, rows)
  const width = Math.max(1, cols)
  const cells: Cell[][] = []

  for (let row = 0; row < height; row++) {
    const line: Cell[] = []

    for (let col = 0; col < width; col++) line.push({ ch: " ", attr: EMPTY })

    cells.push(line)
  }

  return { rows: height, cols: width, cells }
}

export function addnstr(
  screen: Screen,
  row: number,
  col: number,
  text: string,
  n: number,
  attr: Attr = EMPTY,
): void {
  if (row < 0 || row >= screen.rows || col >= screen.cols || n <= 0) return

  const limit = Math.min(text.length, n, screen.cols - Math.max(0, col))
  let x = Math.max(0, col)

  for (let index = 0; index < limit; index++) {
    const ch = text[index]
    const line = screen.cells[row]

    if (ch === undefined || line === undefined) break

    line[x] = { ch, attr }
    x += 1
  }
}

export function plain(screen: Screen): string {
  const lines: string[] = []

  for (const row of screen.cells) {
    let line = ""

    for (const cell of row) line += cell.ch

    lines.push(line)
  }

  return lines.join("\n")
}

function ansiAttr(attr: Attr): string {
  const parts = ["0"]

  if (attr.bold === true) parts.push("1")

  if (attr.dim === true) parts.push("2")

  if (attr.reverse === true) parts.push("7")

  if (attr.fg !== undefined && attr.fg.length === 7 && attr.fg.startsWith("#")) {
    const r = Number.parseInt(attr.fg.slice(1, 3), 16)
    const g = Number.parseInt(attr.fg.slice(3, 5), 16)
    const b = Number.parseInt(attr.fg.slice(5, 7), 16)

    parts.push(`38;2;${r};${g};${b}`)
  }

  return `\u001b[${parts.join(";")}m`
}

export function ansi(screen: Screen): string {
  let out = "\u001b[?25l\u001b[H\u001b[2J"

  for (let row = 0; row < screen.rows; row++) {
    const line = screen.cells[row]

    if (line === undefined) continue

    out += `\u001b[${row + 1};1H`

    let last = ""

    for (const cell of line) {
      const next = ansiAttr(cell.attr)

      if (next !== last) {
        out += next
        last = next
      }

      out += cell.ch
    }

    out += "\u001b[0m"
  }

  return out
}

export type TerminalSize = {
  readonly rows: number
  readonly cols: number
}

export function size(): TerminalSize {
  return {
    rows: process.stdout.rows ?? 24,
    cols: process.stdout.columns ?? 80,
  }
}
