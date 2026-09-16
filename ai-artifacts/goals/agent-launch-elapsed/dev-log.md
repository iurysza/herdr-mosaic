# Dev log

Status: implementing approved plan; no `goal.md` / facts package.

## 2026-09-16 launch clock

Inspected Herdr 0.9.0 `herdr api schema --json`. `pane_agent_detected` carries `pane_id`, `workspace_id`, optional `agent`, `released`, and `final_status`. `pane_agent_status_changed` carries `agent_status` and presentation fields. Neither event has a launch or completion timestamp. Mosaic uses receipt time.

`released: true` is an agent leaving the pane, not a launch. Existing occupancy records without a timestamp are not backfilled. Reconcile still republishes saved clocks and does not invent them.

Changed files: `src/agent_tracker.py`, `src/main.py`, `src/elapsed.py`, `src/sidebar.py`, `src/state.py`, `tests/test_settled.py`, `tests/test_elapsed.py`, `scripts/check-standalone.py`, `README.md`, `docs/elapsed-column.md`, `docs/settings.md`, `docs/config-safety.md`, `docs/herdr-api-findings.md`, `herdr-plugin.toml`.

## Validation

- `python3 -m unittest discover -s tests -t tests`: 259 tests passed.
- `python3 scripts/check-standalone.py`: passed. Launch publishes `now` before the first completion. Timer advanced `1m` plus U+2800 to `2m` plus U+2800. Worker exit, expiry, and byte-exact uninstall passed.
- `python3 scripts/check-elapsed-column.py`: ingestion passed (`passed_metadata`). `termctrl` is unavailable here, so rendered column alignment is unverified, not passed.

Unresolved from the plan: already-running agents with no saved timestamp are not backfilled.

