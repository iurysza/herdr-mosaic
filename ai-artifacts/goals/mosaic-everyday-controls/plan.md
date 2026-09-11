# Plan

Implemented on Mosaic only. No Herdr edits. No live config.

## Done

- `src/agent_view.py`: independent scope and sort. Two definitions. Live workspace filter.
- `src/state.py`: persist `sort_mode`, default `spaces`, reuse `agent_view.normalize_*`.
- `src/main.py`: `toggle-agent-focus`, `sort`, set-on/set-off `view`, reconcile both axes.
- Manifest: new toggle. All legacy IDs kept. Hide-API note once at the actions header.
- Docs: everyday color, tint, focus, equalize/cycle, native split/move/resize. Honest blockers.
- Tests: 2x2 definitions, toggle vs set, sort/focus independence, malformed input, clear-then-toggle, reconcile, and retained IDs. Standalone invokes toggle, old show-* IDs, sort, invalid sort, and restart persistence.
- Elapsed: three-cell published labels, missing placeholder, `99d` saturation, unchanged TTL. Isolated ingestion and actual rendered-column checks pass.

## Not done, and not approximated

- Hiding CLI-only IDs from `plugin.action.list`.
- Native Activity/Spaces button copy or click.
- On-host rendered sort order.
- Literal ASCII-space metadata padding or a reserved column after metadata expiry.

## After a Herdr hide/alias or button API

Hide legacy action IDs without removing invocation support and connect a real two-mode native button. Until then keep every ID listed. A host-side fixed-width token would also keep the elapsed column after expiry.

## Unresolved questions

None for the approved Mosaic-only scope. Host support remains an external dependency.
