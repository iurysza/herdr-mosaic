# Intent

## Outcome

Reimplement Mosaic in TypeScript with Bun, Effect, and Oxlint with anti-slop. Preserve Mosaic's observable behavior while making dependencies, failures, resource ownership, and tests easier to understand and maintain.

The stack is decided. Execute the approved refactor continuously, with evidence for each feature slice and enough durable progress to resume after an interruption.

## Audience and problem

Mosaic users need their existing commands, settings, state, and Herdr integration to keep working. Maintainers need checked contracts, explicit failures, consistent coding rules, and tests that exercise the application without a Herdr installation.

The Python implementation is the behavioral reference. Its module structure is not the architecture to copy.

## Scope

- all dispatcher commands and aliases, manifest actions, hooks, and popup entrypoints
- space identities, palette allocation, custom colors, label rules, and persistence across renames
- theme tint, sidebar markers and titles, elapsed labels, metadata ownership, and window titles
- agent tracking, views, sorting, board, idle cycling, and confirmed stale-agent pruning
- pane movement, promotion, layout cycling, equalization, resizing, and failure recovery
- installation, keybindings, migration, reconciliation, doctor, uninstall, backups, and restoration
- detached refresh scheduling, worker ownership, restart recovery, and shutdown
- production CLI adapters, isolated acceptance tests, differential tests, terminal tests, and compiled release artifacts
- an autonomous execution policy with durable evidence and explicit stop conditions

## Non-goals

- new product features or unapproved changes to user-visible behavior
- a Herdr reimplementation or a new always-running Mosaic server
- a general scenario language or a custom agent orchestration framework
- a Python runtime fallback in the finished TypeScript application
- live cutover, publishing a release, or changing the user's active plugin registration
- proving that TypeScript outperforms Python as a condition for keeping the chosen stack

## Constraints

- Freeze Python at `8b7bb76cf88e9be0452f126209aa58f84be0b0ed`. Its manifest version is `0.5.0`.
- Preserve public IDs, invocation semantics, compatible state, ownership records, and reversible configuration changes.
- Keep real cross-process locking. An in-memory semaphore is insufficient.
- Keep short-lived commands and a detached worker with per-socket ownership.
- Never publish Python and TypeScript metadata to the same live session during comparison.
- Preserve user edits, settings, unrelated repository changes, and licence notices.
- Keep default acceptance tests independent of a Herdr installation or running server.
- Use only isolated disposable environments for real-Herdr checks.
- Keep the approved intent, facts, and plan unchanged during execution. Record implementation progress separately.

## Decisions

The conversation approved these directions:

- commit to TypeScript, Bun, Effect, and Oxlint with anti-slop
- use Effect for application dependencies, expected failures, resources, cancellation, and concurrency
- keep pure decisions as pure functions, with Effect data utilities allowed where useful
- inventory all entrypoints and critical guarantees upfront, then detail scenarios per slice
- prove risky runtime adapters and compiled execution before substantial porting
- start with one reversible configuration operation before the full installation lifecycle
- grow test helpers and fakes alongside features instead of building a general test framework first
- continue automatically after each verified slice without routine approval requests
- stop for a genuine blocker or a decision outside the approved contract

This package records the design. It does not authorize implementation until the fact contract and plan are approved and the goal is explicitly launched.

## Assumptions

- The first reversible operation is sidebar installation and removal.
- Implementation uses a separate worktree because this checkout may be live-linked. The approved goal package must be available to that worktree.
- The existing macOS and Linux platform scope remains. Missing platform evidence blocks completion rather than silently reducing support.
- Exact package versions and adapter choices are implementation decisions within this contract. Record them before use.
- If the selected Effect guidance requires a release candidate, pin its exact version and record the prerelease dependency. Do not mix version-incompatible examples.
- Project-local dependency setup is part of implementation. Machine-wide tool or agent configuration changes require separate approval.
- Performance measurements identify regressions. They do not reopen the stack decision.

## Open questions

No further product decisions are required to draft the contract. Locking, terminal support, packaging, and test-clock choices need early implementation proofs. A failed proof that requires changing this contract returns the package to planning.
