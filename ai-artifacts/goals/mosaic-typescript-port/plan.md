# Mosaic TypeScript port plan

All 27 facts are approved. Implementation starts only after plan approval and an explicit goal launch.

## Outcome and reference

Replace Mosaic's implementation with TypeScript, Bun, and Effect. Enforce strict type checking and Oxlint with vendored anti-slop generic and Effect rules. Preserve the behavior and safety guarantees in [Facts](./facts.md).

Freeze Python at `8b7bb76cf88e9be0452f126209aa58f84be0b0ed`, manifest version `0.5.0`. Compare against that revision throughout the port. Retain Python as an isolated reference and rollback option, never as a runtime dependency of the release artifact.

The stack is decided. Performance measurements identify regressions rather than decide whether to keep TypeScript.

## Execution boundaries

- Work in a separate implementation worktree. Preserve this checkout, unrelated changes, user settings, and live registration.
- Make the approved goal package available in the implementation worktree before starting. Verify the contract files match the approved originals and identify the active progress-log location.
- Keep one writer per worktree. Give any delegated task the exact goal path and require it to read the contract.
- Follow the host's delegation protocol if delegation is useful and authorized. Stop on infrastructure failure, preserve the partial diff, and report the exact failing run and worktree. Do not switch execution protocols without approval.
- Permit repository-local dependency setup and isolated test resources. Do not edit generated global agent configuration or install machine-wide tools without approval.
- Never invoke install, doctor, uninstall, or a publisher against the user's default session during this goal.
- Do not publish a release, change active registration, push changes, or perform live cutover without separate approval.
- Preserve licence notices and relevant public documentation. Do not turn the README into a migration diary.

Read the applicable project skills during execution: `coding-standards`, `domain-modeling`, and the installed Effect and anti-slop guidance. Use `tech-spec` only when a slice needs a concrete implementation handoff. Do not create a speculative specification for every module.

## Implementation structure

Use cohesive feature modules, thin command handlers, and an explicit composition root. Proposed locations are `src/cli.ts`, `src/runtime/`, `src/config/`, `src/spaces/`, `src/agents/`, `src/panes/`, and `src/terminal/`. Create them only as needed. Record internal file-placement decisions in the development log.

Parse external inputs into application types. Preserve reference defaults, missing-value behavior, and accepted state formats. Stricter types must not introduce unapproved input rejection.

Use Effect for dependencies, expected failures, resource ownership, cancellation, and concurrency. Keep calculations and decisions pure. Pure modules may use Effect's data types, schemas, and matching utilities.

Use existing Effect capabilities where they fit. Add application-owned capabilities at genuine boundaries such as Herdr access, configuration ownership, cross-process locks, and terminal control. Do not create a custom dependency container, parallel Result framework, generic workflow engine, or service for every function.

## Continuous execution policy

An explicit goal launch authorizes all approved slices. Do not request routine approval between slices.

1. Read the immutable contract, latest development-log entries, and parity inventory.
2. Verify the checkout and earlier evidence before trusting a recorded completion state.
3. Select the next unfinished slice whose prerequisites have passed.
4. Detail that slice's scenarios and capture the frozen Python behavior.
5. Add failing TypeScript acceptance checks and independent safety assertions.
6. Implement the smallest complete behavior through the production command handlers.
7. Run lint, type checking, relevant regression tests, CLI checks, and applicable differential checks.
8. Review boundaries, failure paths, compatibility, and unnecessary abstractions. Fix findings and rerun affected checks.
9. Record the tested revision or diff fingerprint, changed files, commands, results, evidence paths, and next item.
10. Continue until the final gate passes or a genuine blocker requires owner input.

Repair ordinary application test failures within the loop. Do not weaken a test or normalize a difference merely to obtain a pass.

Stop when implementation contradicts an accepted fact, needs a material contract change, requires unapproved authority, or cannot make verified progress because of infrastructure. State the blocker and what decision or resource would resolve it.

The approved `intent.md`, `facts.md`, `facts.meta.json`, and `plan.md` remain unchanged during execution. Append progress to `dev-log.md`. Update the execution inventory and evidence records without redefining acceptance criteria. Return to setup for a contract change.

A context or runtime limit is an interruption, not completion. Before stopping, record the active worktree, contract identity, current slice, partial work, test failures, owned temporary processes, and exact next action. Do not claim that an automatic continuation exists unless the host actually provides it.

## Progress and evidence

Create `parity.md` during step 1. Give every entry a stable ID and these fields:

`Behavior | Python evidence | Scenario | Expected observations | Comparison rule | TS evidence | Status`

Use `pending`, `in-progress`, `passed`, or `blocked`. A passing row needs a concrete check and evidence from the applicable candidate. Add rows when discovery reveals more existing behavior. Removing a required behavior needs approval.

Create a coverage check that detects reference commands, aliases, actions, hooks, and panes missing from the inventory. Keep the inventory human-readable. Do not build a general planning database.

Store bounded execution evidence under this goal's `evidence/` directory. Record exit status, stdout and stderr, relevant file bytes, observed Herdr requests, resulting fake-server state, and terminal captures where applicable. Exclude credentials and unrelated user data.

Use comparison rules appropriate to the guarantee:

- exact bytes for promised configuration restoration and untouched content
- compatible values and ownership records for durable state
- eligibility, outcomes, and meaningful ordering for destructive operations
- visible cells, keys, focus, cancellation, and exit behavior for terminal workflows
- documented normalization for incidental paths, transport IDs, and other proven nondeterminism

Do not normalize meaningful timestamps, ownership, operation ordering, or conflicting configuration changes. Do not compute expected results with the code under test.

## Ordered implementation steps

### 1. Freeze the reference and inventory the contract

Read the frozen dispatcher, manifest, tests, and verified Herdr findings. The on-disk `AGENTS.md` still names version `0.1.0`; use the frozen manifest and code for the release baseline.

Inventory every command, alias, action, hook, and popup upfront. Record critical state fields, ownership rules, and recovery guarantees. Detail individual scenarios only when their slice starts.

Record disagreements among documentation, tests, and observed Python behavior. Preserve existing behavior unless it conflicts with an accepted safety fact. Escalate such conflicts instead of choosing silently. Preserve documented quirks such as `install --dry-run` previewing migration only.

Reference files: `src/main.py`, `src/ctx.py`, `src/state.py`, `herdr-plugin.toml`, `tests/`, `docs/herdr-api-findings.md`, `docs/config-safety.md`, and `docs/actions.md`.

Outputs: `parity.md`, reference revision and extraction instructions, a minimal coverage check, and a development-log checkpoint. Keep reference source outside the production bundle. Do not import Python modules before setting an isolated environment.

Gate: every known entrypoint has an inventory row and evidence source. Critical safety guarantees are recorded. No exhaustive scenario catalogue is required yet.

### 2. Establish the stack and prove runtime boundaries

Add `package.json`, the Bun lockfile, `tsconfig.json`, Oxlint configuration, vendored anti-slop rules, and the minimal production CLI. Pin Bun, TypeScript, Effect, Oxlint, and compatible plugin versions. Record upstream anti-slop provenance.

Use the official Effect skill and read the installed `node_modules/effect/AGENTS.md` completely before writing Effect code. Record any release-candidate choice. Resolve project skill symlinks before installation and preserve shared or generated resources.

Update `AGENTS.md` only in the implementation worktree. Replace the Python-only implementation rule while retaining ownership, restoration, locking, metadata, and live-session safeguards.

Start tests with ordinary TypeScript code and fixtures. Add small helpers under `tests/support/` for isolated environments, subprocess capture, a fake Herdr socket, and a fake executable. Default tests must not discover or import the separate real-Herdr suite.

Prove the following before substantial feature porting:

- compile and run the CLI without relying on the pane's PATH or working directory
- prevent ambient `.env` and `bunfig.toml` from changing invocation behavior
- acquire the same cross-process lock from separate processes, contend safely, and release it after interruption or process death
- establish one effective worker owner, detach it, and clean up owned test descendants
- enter terminal raw mode, read input, resize, cancel, and restore terminal state
- distinguish real subprocess time from injected application time

Use an OS-backed advisory lock or another mechanism demonstrated to meet the accepted semantics. An Effect semaphore or finalizer alone cannot provide process-death guarantees. Prove the chosen mechanism on macOS and Linux with actual execution, not compilation alone.

Use virtual time in application tests and targeted real-time subprocess checks initially. Add cross-process virtual time only if required scenarios justify it. Test composition must call the same application handlers as production.

Add an early disposable real-Herdr conformance check for the consumed transport and validator contracts. Adapt the isolation approach in `scripts/check-standalone.py`. Record the Herdr version and protocol, and preserve the advertised compatibility contract.

Reference files: `src/ctx.py`, `src/rpc.py`, `src/refresh.py`, popup modules, `scripts/check-standalone.py`, and `.github/workflows/verify.yml`.

Gate: a compiled CLI scenario works without Herdr, isolation rejects unsafe fallback, runtime proofs pass on both platforms, and the initial fake contract has real-Herdr evidence. Missing execution infrastructure is a blocker.

### 3. Complete one reversible configuration slice

Implement sidebar installation and removal through real command handlers. Port the required settings, state, and configuration behavior without translating all Python modules upfront.

Keep surgical TOML editing, baseline-aware diagnostics, backups, atomic writes, absent-versus-present restoration, ownership conflict handling, and preservation of `rows_by_agent`.

Begin with small fixtures, then cover the command's owned behavior. An empty-state fixture is a starting case, not proof of the whole command.

Reference files: `src/main.py` sidebar commands, `src/config_patch.py`, `src/toml_edit.py`, `src/state.py`, `tests/test_toml_edit.py`, and sidebar lifecycle cases in `tests/test_bundle.py`.

Expected targets: `src/cli.ts`, `src/config/`, the required runtime adapters, and focused CLI and parity tests.

Gate: install, repeat installation, removal, validation rejection, pre-existing diagnostics, missing keys, external edits, and exact promised restoration pass. Python reads TS-written state and restoration records in an isolated rollback case. Review this slice's maintainability before repeating its patterns.

### 4. Complete installation, identity, and recovery

Extend the proven configuration slice into full setup. Add identity assignment, label rules, migrations, managed keybindings, reconciliation, doctor, and uninstall. Add supporting view or publication behavior where the reference lifecycle requires it.

Preserve Window Manager restore records intact. Refuse stale Chromatic backups. Test repeated setup, failed writes, interrupted operations, occupied shortcuts, and preservation of pre-existing user state.

Reference files: `src/main.py`, `src/identity.py`, `src/labels.py`, `src/migrate.py`, `src/state.py`, `src/agent_view.py`, and lifecycle cases in `tests/test_bundle.py`, `tests/test_plugin.py`, and `tests/test_public_api.py`.

Expected targets: the CLI, `src/config/`, `src/spaces/`, required `src/agents/` operations, and lifecycle fixtures.

Gate: the full install, identity, reconcile, uninstall, and rollback sequence matches the reference. Command dependencies must be implemented before their entrypoint is marked passed. Do not add success-returning stubs to satisfy lifecycle tests.

### 5. Finish features in bounded sub-slices

Complete each sub-slice through the continuous execution loop before expanding to the next. Detail scenarios when the sub-slice starts. Source filenames in the table are under `src/`; test filenames are under `tests/`.

| Sub-slice | Python sources and existing evidence | Required observations |
| --- | --- | --- |
| Space colors and theme | `identity.py`, `labels.py`, `theme.py`, relevant `main.py` commands, `test_mosaic.py` | allocation, rename stability, exact custom tint, nearest sidebar slot, intensity, previews, repalette, focus no-ops, restoration |
| Sidebar, clocks, and refresh | `metadata.py`, `sidebar.py`, `elapsed.py`, `agent_tracker.py`, `refresh.py`, `test_sidebar.py`, `test_elapsed.py`, `test_settled.py` | titles, launch and completion transitions, protected metadata, token limits, TTL, singleton ownership, restart, disable and uninstall cleanup |
| Agent views and triage | `agent_view.py`, `agent_triage.py`, relevant `main.py` commands, `test_agent_triage.py`, `test_public_api.py` | scope and sort independence, compatibility commands, idle cycling, stale thresholds, protected agents, fresh eligibility before closure |
| Pane operations | `layouts.py`, `layout_actions.py`, `pane_move.py`, `test_layouts.py`, `test_pane_move.py`, layout cases in `test_bundle.py` | pick-and-place, promotion, layout cycle, equalization, 2% resize, stale selections, partial-failure recovery |
| Interactive workflows | `picker.py`, `board.py`, `prune.py`, `pane_move.py` | actual pseudo-terminal navigation, confirmation, cancellation, resize, small terminals, process exit, and terminal restoration |
| Remaining maintenance and aliases | dispatcher and manifest inventory, `test_plugin.py`, `test_public_api.py` | every remaining command, alias, event envelope, error outcome, environment input, and popup launch |

Expected targets: cohesive modules under `src/spaces/`, `src/agents/`, `src/panes/`, `src/terminal/`, and the associated CLI tests. Keep UI decisions testable as pure transitions, with actual terminal tests proving the renderer and input adapter.

Gate per sub-slice: CLI checks, applicable differential comparisons, independent safety assertions, and relevant regression tests pass. Inventory rows cite evidence. No module mocking is introduced.

### 6. Stress integration boundaries

Extend the existing tests instead of building a second application simulator. Cover overlapping hooks, lock contention, worker-start races, socket replacement, fragmented responses, interleaved events, malformed responses, validator failures, external edits, interrupted writes, stale selections, and partial layout failures.

Use fault injection at external capabilities or real adapter boundaries. Do not patch application modules. Record which faults use injected capabilities and which exercise actual subprocess behavior.

Reference files: safety cases across `tests/`, the frozen RPC and worker modules, `docs/config-safety.md`, and `docs/herdr-api-findings.md`.

Expected targets: existing adapters, CLI and runtime test suites, and `tests/support/` extensions justified by actual cases.

Gate: both platforms pass the concurrency and lifecycle checks. Required failures preserve state or provide the documented recovery outcome. Detached test processes and temporary resources are cleaned up.

### 7. Package and verify the exact candidate

Complete the platform build and manifest launch strategy. Remove Python runtime commands from the production manifest while preserving public IDs and invocation behavior. Verify worker relaunch and popup entrypoints against the built artifact.

Update `herdr-plugin.toml`, relevant release and CI configuration, `README.md`, `docs/actions.md`, `docs/settings.md`, `docs/releases.md`, and `AGENTS.md` as needed. Keep Python comparison tooling separate from the shipped runtime. Preserve licence notices.

Run all final checks against the exact candidate. Record its revision or diff fingerprint, build commands, artifact hashes, OS and architecture, tool versions, and Herdr version and protocol.

Measure Python and TypeScript startup, event processing, worker CPU and memory, and package size with reproducible fixtures. Record sampling and measurement conditions. Do not invent performance limits without baseline evidence.

Write `completion.md` with inventory coverage, automated results, manual review evidence, performance results, remaining risks, and a cutover and rollback procedure. Do not execute cutover.

Gate: every accepted fact has evidence, all inventory rows pass, the compiled artifact passes isolated real-Herdr lifecycle and rollback checks, and no required platform or compatibility result is missing. A skipped check or unexplained difference blocks completion.

## Verification commands to establish

These are proposed interfaces to implement, not commands currently present in this repository.

| Command | Purpose |
| --- | --- |
| `bun run mosaic -- <command>` | production command handlers during development |
| `bun run lint` | Oxlint and both anti-slop rule groups, including proven Bun mocking coverage |
| `bun run typecheck` | strict TypeScript checking without emit |
| `bun run test` | default pure, application, and CLI suites without Herdr |
| `bun run test:parity` | frozen Python and TypeScript comparisons plus inventory coverage |
| `bun run test:runtime` | real process, lock, worker, and pseudo-terminal checks |
| `bun run test:herdr` | explicitly isolated real-Herdr conformance and lifecycle checks |
| `bun run build` | compiled release artifact for the selected target |
| `bun run test:artifact` | built artifact, manifest, minimal PATH, ambient configuration, and rollback checks |
| `bun run bench` | reproducible reference and candidate measurements |

Keep the default suite independent of optional Herdr and reference tooling. Run differential and real-Herdr checks in separate explicit jobs. Runtime tests must execute on macOS and Linux. Cross-compilation alone does not establish either platform's behavior.

## Fact coverage

| Fact | Primary step | Required evidence |
| --- | --- | --- |
| `fact-01` | 2, 7 | toolchain and production artifact without Python runtime commands |
| `fact-02` | 2, 7 | exact pins, provenance, typecheck and lint output, rejected module-mocking fixtures |
| `fact-03` | 1, 4, 5, 7 | frozen reference identity, entrypoint coverage, CLI and manifest compatibility checks |
| `fact-04` | 1, 5, 7 | inventory coverage check and a passing scenario for every capability |
| `fact-05` | 3, 6 | candidate validation, baseline diagnostics, backups, conflicts, atomic-write cases |
| `fact-06` | 3, 4, 7 | exact restoration, absent-key, user-edit, keybinding, and explicit-force cases |
| `fact-07` | 4 | Window Manager and Chromatic migration fixtures and retained source data |
| `fact-08` | 3, 4, 7 | legacy input fixtures and Python-after-TypeScript rollback |
| `fact-09` | 2, 6, 7 | native macOS and Linux contention, interruption, death, and worker-lock results |
| `fact-10` | 3, 5 | metadata ownership, rows_by_agent, token limits, title and elapsed expiry cases |
| `fact-11` | 2, 5, 6 | worker singleton, reconciliation, restart, ownership-loss, and cleanup checks |
| `fact-12` | 5, 6 | confirmation, protected-agent, and became-ineligible race tests |
| `fact-13` | 5, 6 | pane movement and recovery evidence after injected partial failures |
| `fact-14` | 2, 3, 7 | default CLI suite with Herdr unavailable |
| `fact-15` | 2, 6, 7 | poisoned ambient inputs, missing-path rejection, and descendant cleanup checks |
| `fact-16` | 2, 5, 6 | lint fixtures, strict fake protocol tests, and external-capability test composition |
| `fact-17` | 3 through 7 | differential results, independent assertions, and reviewed normalization rules |
| `fact-18` | 2, 5, 7 | scripted terminal captures and terminal-restoration results |
| `fact-19` | 2, 7 | compiled artifact and manifest checks from unrelated directories under minimal PATH |
| `fact-20` | 2, 7 | early and final real-Herdr conformance results and platform evidence |
| `fact-21` | 1 through 4 | reviewed development-log sequence and slice gates |
| `fact-22` | 3, 5, 7 | recorded architecture and maintainability review findings and resolutions |
| `fact-23` | all | execution history showing the continuous loop and any justified stop |
| `fact-24` | all | append-only evidence records and resume validation |
| `fact-25` | all | reviewed worktree, environment, authority, and unrelated-change preservation evidence |
| `fact-26` | 2, 7 | reproducible baseline and final measurement output |
| `fact-27` | 7 | exact-candidate completion audit with no missing required evidence |

## Risks and accepted assumptions

- Native locking and terminal adapters may affect standalone packaging. Resolve them in step 2 before copying their assumptions across features.
- The official Effect skill may target a prerelease. Pin it, use version-matched guidance, and record upgrades rather than changing dependencies mid-slice without evidence.
- Anti-slop rules influence code structure. Prefer supported Effect patterns and review local rule changes instead of hiding broad exceptions.
- Strict parsing can accidentally break compatible inputs. Keep representative legacy state and malformed-input outcomes in differential tests.
- Test fakes can disagree with Herdr. Validate the consumed contract early and again at the final gate.
- Configuration and state writes are separate operations. Test interruption boundaries without claiming a multi-file transaction that the reference does not provide.
- Native platform or real-Herdr infrastructure may be unavailable. Report the precise missing gate and request access or approval instead of reducing support.
- A session may end before the refactor finishes. Durable checkpoints support resumption but do not imply unlimited context, cost, or execution time.

## Unresolved questions

No blocking product or stack questions remain. Exact dependency versions, native adapters, internal file placement, and build targets are implementation decisions to prove within the accepted contract. Escalate any choice that changes compatibility, supported environments, scope, or safety guarantees.
