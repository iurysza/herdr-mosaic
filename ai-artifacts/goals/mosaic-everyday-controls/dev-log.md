# Dev log

Status: Approved Mosaic-only scope implemented and verified. Host-dependent requirements remain blocked.

## 2026-09-11 capability checkpoint

Two Grok 4.6 agents ran through Herdr in separate worktrees. The parent reviewed and integrated their changes.

Installed Herdr is 0.8.2, protocol 20. Isolated probe `/tmp/mosaic-checkpoint-vtL82b` found no hidden-action or native-button extension API. Unknown `hidden` and alias fields were dropped. Filter-only views still disable the native button. Read-only Herdr source inspection did not change that repository.

The user chose "Keep this Mosaic-only" after reviewing these limits. Every existing action ID stays callable and visible. The menu is not trimmed; the native button is not replaced.

## Implementation

- Added `toggle-agent-focus` and CLI `sort activity|spaces`, with independent saved scope and sort settings.
- Preserved old set-on/set-off actions and restart reconciliation.
- Kept color, tint, equalize, and cycle as the documented everyday controls. Native Herdr controls handle workspace operations, splits, moves, and resizing.
- Integrated the elapsed worktree: three-cell published values, blank placeholders, and `99d` saturation. The 30-second refresh and 45-second TTL are unchanged.
- Kept the existing U+2800 pad because Herdr trims ASCII spaces. Literal spaces and a reserved column after expiry are not supported.

## Parent review fixes

- Rejected malformed sort and toggle arguments without changing state.
- Fixed the first toggle after `view-clear` to enable current-space focus.
- Made elapsed probes portable and isolated. Used the installed native `termctrl` executable instead of its Volta shim inside disposable HOME.
- Restricted visual probe names to agent rows so workspace headings cannot produce false alignment passes.
- Verified clock changes keep titles aligned and explicit clears remove the column.
- Corrected rounding documentation and linked the elapsed contract from the README.

## Validation

- `python3 -m unittest discover -s tests -t tests`: 238 tests passed.
- `python3 scripts/check-standalone.py`: passed on the combined checkout. Install, legacy actions, scope/sort persistence, restart, clock advancement, worker exit, expiry, and byte-exact uninstall restoration passed.
- `TERMCTRL_BIN="$(volta which termctrl)" python3 scripts/check-elapsed-column.py`: ingestion and actual rendering passed. Every tested title starts at zero-based column 9, including during clock changes. Clear moves it to column 3.
- System Python compilation and `git diff --check`: passed.

Bounded evidence and full temporary receipt paths are in [verification.json](verification.json). Rendered sort order remains unmeasured; definitions, server acceptance, and persistence are covered.

No live config changes, Herdr source changes, commits, or pushes. The elapsed worktree is retained at `../herdr-mosaic-elapsed`.

## 2026-09-11 sorting shortcut

Added `toggle-agent-sort` to `herdr-plugin.toml`. It flips only the existing Activity and Spaces definitions and retains current-space focus. Mosaic setup now adds `prefix+shift+s` when the key is free. `sort-keybind-install` and `sort-keybind-remove` manage it from the CLI. An existing matching binding is not claimed, so uninstall keeps it.

The live Herdr config was inspected only. `prefix+shift+s` is unassigned. It was not edited. The isolated lifecycle invokes the manifest action, confirms setup writes the keybinding, and confirms uninstall restores the original config byte-for-byte. Full suite after the change: 242 tests passed.
