export type FlagMap = {
  get(key: string): string | undefined
  has(key: string): boolean
}

class ParsedFlags implements FlagMap {
  constructor(private readonly values: ReadonlyArray<readonly [string, string]>) {}

  get(key: string): string | undefined {
    for (const [name, value] of this.values) {
      if (name === key) return value
    }

    return undefined
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }
}

export function parseKv(argv: readonly string[]): FlagMap {
  const values: Array<readonly [string, string]> = []
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]

    if (arg === undefined) break

    if (arg.startsWith("--")) {
      const key = arg.slice(2)

      if (key.includes("=")) {
        const eq = key.indexOf("=")

        values.push([key.slice(0, eq), key.slice(eq + 1)])
      } else {
        const next = argv[i + 1]

        if (next !== undefined && !next.startsWith("--")) {
          values.push([key, next])
          i += 1
        } else {
          values.push([key, "true"])
        }
      }
    } else if (arg.includes("=") && !arg.startsWith("-")) {
      const eq = arg.indexOf("=")
      const key = arg.slice(0, eq)

      if (key !== "") values.push([key, arg.slice(eq + 1)])
    }

    i += 1
  }

  return new ParsedFlags(values)
}

export function flagString(flags: FlagMap, key: string): string | undefined {
  const value = flags.get(key)

  if (value === undefined || value === "true") return undefined

  return value
}
