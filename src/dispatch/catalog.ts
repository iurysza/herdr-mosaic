export const HELP = `usage: main.py <command> [args]

Space color:
  pick-color                         Open the current space's color picker
  set-color --workspace ID --color NAME_OR_HEX
                                     Set a color without opening a popup
  list-colors                        List space colors and the palette
  assign-colors                      Color spaces without an assignment

Tint:
  tint-enable | tint-disable         Enable tint, or stop and restore the theme
  tint-intensity subtle|medium|bold   Set strength; no argument shows the setting
  tint-preview                       Print swatches for the current space

Agent view:
  agents all|current                 Show agents in all spaces or the current one
  toggle-agent-focus                 Toggle current-space focus
  toggle-agent-sort                  Toggle Activity and Spaces sorting
  sort [activity|spaces]             Set or show the sort without changing focus
  agent-board                        Open collapsible agent groups
  next-idle-agent                    Focus the next idle/done agent and wrap
  prune-stale-agents                 Open confirmed stale-agent termination UI

Pane moves:
  move-pane                           Pick focused pane, then confirm a destination
  promote-pane                        Move focused pane to a new tab

Pane layouts:
  arrange-columns                    Arrange existing panes as equal-width columns
  next-layout                        Cycle existing pane arrangements
  layout resize-left|resize-right|resize-up|resize-down
                                     Resize the current pane split by 2%
  Unzoom before arranging. Use herdr pane split/move for new splits and moves.

Advanced setup and maintenance:
  install [--dry-run], uninstall [--force], doctor, migrate [--dry-run]
  keybind-install [--key KEY], keybind-remove, theme-restore [--force]
  idle-keybind-install [--key KEY], prune-keybind-install [--key KEY]
  pane-move-keybind-install [--key KEY], promote-pane-keybind-install [--key KEY]
  repalette [--dry-run], marker [GLYPH], announce on|off, view-clear, state
  install --dry-run previews saved-state import only.

Internal hooks and recovery:
  reconcile, event, sidebar-install, sidebar-remove, picker, board, pane-move,
  elapsed-publish, refresh-worker

Existing command names and action IDs remain supported. See docs/actions.md.
CLI aliases do not add Herdr menu entries. Action invocation accepts no CLI args.
`

export const COMMANDS = [
  "reconcile",
  "event",
  "install",
  "migrate",
  "layout",
  "set-identity",
  "apply-identity",
  "auto-assign",
  "tint-enable",
  "tint-disable",
  "theme-restore",
  "sidebar-install",
  "sidebar-remove",
  "repalette",
  "intensity",
  "marker",
  "announce",
  "preview",
  "keybind-install",
  "keybind-remove",
  "sort-keybind-install",
  "sort-keybind-remove",
  "idle-keybind-install",
  "idle-keybind-remove",
  "prune-keybind-install",
  "prune-keybind-remove",
  "view",
  "toggle-agent-focus",
  "toggle-agent-sort",
  "next-idle-agent",
  "prune-stale-agents",
  "prune",
  "move-pane",
  "promote-pane",
  "pane-move",
  "pane-move-keybind-install",
  "pane-move-keybind-remove",
  "promote-pane-keybind-install",
  "promote-pane-keybind-remove",
  "sort",
  "view-clear",
  "picker",
  "board",
  "board-open",
  "doctor",
  "uninstall",
  "list",
  "state",
  "elapsed-publish",
  "refresh-worker",
] as const

export type CommandName = (typeof COMMANDS)[number]

export const COMMAND_SET: ReadonlySet<string> = new Set(COMMANDS)

export const CLI_ALIASES = {
  "agent-board": ["board-open"],
  agents: ["view"],
  "arrange-columns": ["layout", "equalize"],
  "assign-colors": ["auto-assign"],
  "list-colors": ["list"],
  "next-layout": ["layout", "cycle"],
  "pick-color": ["set-identity"],
  "set-color": ["apply-identity"],
  "tint-intensity": ["intensity"],
  "tint-preview": ["preview"],
} as const

const ALIAS_NAMES = [
  "agent-board",
  "agents",
  "arrange-columns",
  "assign-colors",
  "list-colors",
  "next-layout",
  "pick-color",
  "set-color",
  "tint-intensity",
  "tint-preview",
] as const satisfies ReadonlyArray<keyof typeof CLI_ALIASES>

export function processCliArgv(argv: readonly string[]): string[] {
  const script = argv[1] ?? ""

  if (script.endsWith("cli.ts") || script.endsWith("cli.js") || script.includes("$bunfs")) {
    return argv.slice(2)
  }

  return argv.slice(1)
}

export function rewriteArgv(argv: readonly string[]): string[] {
  if (argv.length === 0) return []

  const first = argv[0]

  if (first === undefined) return []

  for (const alias of ALIAS_NAMES) {
    if (alias === first) return [...CLI_ALIASES[alias], ...argv.slice(1)]
  }

  return [...argv]
}

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.length === 0 || argv.some((arg) => arg === "-h" || arg === "--help")
}

export function helpText(): string {
  let text = HELP.endsWith("\n") ? HELP : `${HELP}\n`
  text += "\nCLI aliases (preferred -> existing):\n"

  for (const alias of ALIAS_NAMES) {
    const target = CLI_ALIASES[alias]
    text += `  ${alias} -> ${target.join(" ")}\n`
  }

  return text
}
