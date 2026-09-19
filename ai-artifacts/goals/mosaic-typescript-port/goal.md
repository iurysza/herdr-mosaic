# Goal

Reimplement Mosaic in TypeScript with Bun, Effect, and Oxlint with anti-slop. Preserve the frozen Python reference's behavior and safety guarantees while improving maintainability through checked contracts, explicit failures, resource ownership, and isolated tests.

Execute the approved plan continuously after one explicit launch. Record evidence for every completed slice and preserve enough state to resume after an interruption.

Status: Ready for execution. Implementation has not started.

## Contract

- [Intent](./intent.md)
- [Facts](./facts.md)
- [Fact metadata](./facts.meta.json)
- [Plan](./plan.md)
- [Dev log](./dev-log.md)

All 27 facts and the implementation plan are approved. The review tool's supporting files are provenance, not required execution inputs.

## Execution

Use the `goal` skill. Follow the plan's ordered stages, continuous execution policy, verification gates, and stop conditions. Do not request routine approval between slices.

Keep the approved contract unchanged. Append execution evidence to the dev log and update the parity inventory created during step 1. Work in an isolated implementation worktree and keep live cutover outside this goal.

## Done when

- the compiled application uses the committed stack and has no Python runtime dependency
- every inventory item and automated fact has passing evidence for the applicable candidate
- manual facts have recorded review evidence and resolved findings
- native macOS and Linux checks, real-Herdr compatibility, and Python rollback pass
- final artifact checks and reproducible measurements refer to the exact candidate
- no unexplained parity differences or unresolved required gates remain
- the completion report identifies evidence, remaining non-blocking risks, and the unexecuted cutover procedure

## Launch

```text
/goal ai-artifacts/goals/mosaic-typescript-port/goal.md
```
