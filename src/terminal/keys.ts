export type Key =
  | { readonly type: "char"; readonly code: number }
  | { readonly type: "up" }
  | { readonly type: "down" }
  | { readonly type: "enter" }
  | { readonly type: "escape" }

export function isChar(key: Key, letter: string): boolean {
  return key.type === "char" && key.code === letter.charCodeAt(0)
}

export function isEnter(key: Key): boolean {
  return key.type === "enter" || (key.type === "char" && (key.code === 10 || key.code === 13))
}

export function isEscape(key: Key): boolean {
  return key.type === "escape" || isChar(key, "q")
}

export type DecodedKeys = {
  readonly keys: Key[]
  readonly pending: number[]
}

export function decodeKeys(bytes: Uint8Array, pending: readonly number[]): DecodedKeys {
  const codes = [...pending, ...bytes]
  const keys: Key[] = []
  let index = 0

  while (index < codes.length) {
    const first = codes[index]

    if (first === undefined) break

    if (first === 27) {
      const second = codes[index + 1]
      const third = codes[index + 2]

      if (second === undefined) break

      if (second === 91) {
        if (third === undefined) break

        if (third === 65) keys.push({ type: "up" })
        else if (third === 66) keys.push({ type: "down" })
        else if (third === 67 || third === 68) {
          // ignore left/right
        } else {
          keys.push({ type: "escape" })
        }

        index += 3
        continue
      }

      keys.push({ type: "escape" })
      index += 1
      continue
    }

    if (first === 10 || first === 13) keys.push({ type: "enter" })
    else keys.push({ type: "char", code: first })

    index += 1
  }

  return { keys, pending: codes.slice(index) }
}
