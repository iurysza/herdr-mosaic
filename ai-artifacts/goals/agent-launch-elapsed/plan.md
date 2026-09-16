# Start the elapsed clock when an agent launches

Status: behaviour approved; implementation pending.

## Goal

Show `now` as soon as an agent launches, even before its first message. Use launch time as the initial `last_settled_at`, then reset it on later completions. The label means time since launch or the latest completion, never time since focus.

## Current behaviour

A newly launched Pi agent has no recorded completion. `src/agent_tracker.py` only sets `last_settled_at` on direct `working -> idle` or `working -> done` transitions.

The reported screenshots show an agent without a time label, sometimes with a gap and separator. Current `main` already publishes a fixed three-cell blank for missing timestamps. Expired or cleared metadata still collapses the column. See `docs/elapsed-column.md` for the verified rendering contract. Do not undo that fix or treat launch initialisation as a fix for metadata expiry.

## Required behaviour

- Initialise the clock once when a new agent launches, without requiring a message or completion.
- Publish the initial label through the existing sidebar path, without waiting for another agent event.
- Preserve valid saved timestamps during duplicate detection, focus changes, and reconciliation.
- Handle detection and the first status event in either order without resetting the initial clock or losing the latest status.
- Continue resetting the clock only on direct `working -> idle` or `working -> done` completions after initialisation.
- Preserve blocked and unknown transition rules. Those transitions must not count as completions.
- Keep the clock running from the previous completion while a later turn is working.

## Implementation steps

1. Read `AGENTS.md`, `docs/herdr-api-findings.md`, and `docs/elapsed-column.md`. Inspect `pane.agent_detected` payloads and the existing event dispatch before choosing the initialisation point. Verify whether Herdr supplies a launch timestamp. If only receipt time is available, document that approximation.
2. Add focused regression tests for launch initialisation and event ordering. Keep timestamp decisions in the pure tracking logic in `src/agent_tracker.py`; keep event handling and persistence in `src/main.py`.
3. Initialise and persist the timestamp under `ctx.Lock`, then publish through the existing sidebar path. Reuse the current state record where practical. Do not add a second timer, metadata source, or scheduler.
4. Update existing tests that require newly detected agents to remain without a timestamp. Preserve blank-label tests for genuinely missing or invalid records.
5. Update comments and user documentation that describe the label as completion-only. Adjust the launch scenario in `scripts/check-standalone.py` to expect `now` before the first completion.
6. Run unit tests and isolated lifecycle checks. Report commands, results, and any unverified rendering behaviour.

## Files to inspect

- `src/agent_tracker.py`: timestamp and status transitions.
- `src/main.py`: detection, status-change handling, reconciliation, and publication.
- `src/state.py`: durable `agent_settled` records.
- `src/elapsed.py`: fixed-width formatting and blank fallback.
- `src/sidebar.py` and `src/refresh.py`: metadata publication and refresh.
- `tests/test_settled.py`, `tests/test_elapsed.py`, and `tests/test_sidebar.py`: regression coverage.
- `scripts/check-standalone.py` and `scripts/check-elapsed-column.py`: isolated lifecycle and rendering checks.
- `docs/elapsed-column.md`: current display contract.

## Acceptance checks

- A fresh agent with no messages shows `now`, then advances using the existing formatter.
- Detection before a status event and a status event before detection both initialise exactly once.
- A later direct completion resets the timestamp.
- Duplicate events, focus changes, and restart/reconciliation preserve an existing timestamp.
- Blocked and unknown transitions preserve the current timestamp without recording a completion.
- Closing a pane retains the existing state-cleanup behaviour.
- Labels retain the three-cell width, existing rounding, U+2800 padding, and `99d` cap.
- The 30-second refresh, 45-second expiry, `agent-elapsed` source, and `$elapsed` token stay unchanged.
- Mosaic does not modify `$themed_model_tier` or agent-specific row overrides.

Run:

```sh
python3 -m unittest discover -s tests -t tests
python3 scripts/check-standalone.py
python3 scripts/check-elapsed-column.py
```

Use disposable Herdr HOME, config, socket, and registry locations. Do not install, run doctor, or test mutations against the default live session without approval. Report missing renderer tooling as unverified, not passed. Keep the implementation Python standard library only, compatible with Python 3.6+.

## Out of scope

Do not change Herdr's renderer, remove metadata expiry, introduce a current-turn duration, or reset clocks on focus. Leave unrelated workspace changes untouched.

## Unresolved question

For an already-running agent with no saved timestamp, should first detection initialise the clock to the current time? Confirm before adding backfill. That time is not its actual launch time.
