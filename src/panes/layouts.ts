export type PaneNode = {
  readonly type: "pane"
  readonly pane_id: string
}

export type SplitNode = {
  readonly type: "split"
  readonly direction: string
  readonly ratio: number
  readonly first: LayoutNode
  readonly second: LayoutNode
}

export type LayoutNode = PaneNode | SplitNode

export type LayoutPreset = {
  readonly name: string
  readonly tree: LayoutNode
}

export type InsertionMove = {
  readonly targetId: string
  readonly sourceId: string
  readonly direction: string
  readonly ratio: number
}

export function pane(paneId: string): PaneNode {
  return { type: "pane", pane_id: paneId }
}

export function split(
  direction: string,
  ratio: number,
  first: LayoutNode,
  second: LayoutNode,
): SplitNode {
  return { type: "split", direction, ratio, first, second }
}

export function balanced(ids: readonly string[], direction: string): LayoutNode {
  if (ids.length === 1) {
    const only = ids[0]

    if (only === undefined) return pane("")

    return pane(only)
  }

  const midpoint = Math.floor(ids.length / 2)

  return split(
    direction,
    midpoint / ids.length,
    balanced(ids.slice(0, midpoint), direction),
    balanced(ids.slice(midpoint), direction),
  )
}

export function tiled(ids: readonly string[], direction = "right"): LayoutNode {
  if (ids.length === 1) {
    const only = ids[0]

    if (only === undefined) return pane("")

    return pane(only)
  }

  const midpoint = Math.floor((ids.length + 1) / 2)
  const alternate = direction === "right" ? "down" : "right"

  return split(
    direction,
    midpoint / ids.length,
    tiled(ids.slice(0, midpoint), alternate),
    tiled(ids.slice(midpoint), alternate),
  )
}

export function same(first: LayoutNode, second: LayoutNode): boolean {
  if (first.type !== second.type) return false

  if (first.type === "pane") {
    return second.type === "pane" && first.pane_id === second.pane_id
  }

  if (second.type !== "split") return false

  return first.direction === second.direction
    && Math.abs(first.ratio - second.ratio) < 0.01
    && same(first.first, second.first)
    && same(first.second, second.second)
}

export function paneIds(node: LayoutNode): string[] {
  if (node.type === "pane") {
    if (node.pane_id !== "") return [node.pane_id]

    throw new Error("layout contains a pane without an id")
  }

  return [...paneIds(node.first), ...paneIds(node.second)]
}

export function firstPane(node: LayoutNode): string {
  let current: LayoutNode = node

  while (current.type === "split") {
    current = current.first
  }

  if (current.pane_id !== "") return current.pane_id

  throw new Error("layout contains a pane without an id")
}

export function insertionPlan(node: LayoutNode): InsertionMove[] {
  if (node.type === "pane") return []

  const move: InsertionMove = {
    targetId: firstPane(node.first),
    sourceId: firstPane(node.second),
    direction: node.direction,
    ratio: node.ratio,
  }

  return [move, ...insertionPlan(node.first), ...insertionPlan(node.second)]
}

export function presets(ids: readonly string[]): LayoutPreset[] {
  const candidates: LayoutPreset[] = [
    { name: "even-vertical", tree: balanced(ids, "right") },
    { name: "even-horizontal", tree: balanced(ids, "down") },
  ]

  if (ids.length > 1) {
    const rest = ids.slice(1)
    const firstId = ids[0] ?? ""

    candidates.push(
      { name: "main-left", tree: split("right", 0.6, pane(firstId), balanced(rest, "down")) },
      { name: "main-top", tree: split("down", 0.6, pane(firstId), balanced(rest, "right")) },
      { name: "tiled", tree: tiled(ids) },
    )
  }

  const unique: LayoutPreset[] = []

  for (const candidate of candidates) {
    if (!unique.some((existing) => same(candidate.tree, existing.tree))) {
      unique.push(candidate)
    }
  }

  return unique
}

export function targetFor(action: string, root: LayoutNode): LayoutNode {
  const choices = presets(paneIds(root))
  const first = choices[0]

  if (first === undefined) return root

  if (action === "equalize") return first.tree

  let current = -1

  for (let index = 0; index < choices.length; index++) {
    const choice = choices[index]

    if (choice !== undefined && same(root, choice.tree)) {
      current = index
      break
    }
  }

  return choices[(current + 1) % choices.length]?.tree ?? first.tree
}
