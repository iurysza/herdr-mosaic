# Goal

Mosaic users move between tabs, through the sidebar's displayed agent list, and to the newest or oldest eligible agent from the keyboard. Tab and agent-list shortcuts use Herdr's existing cyclers. The two agent jumps share one blocked-first order.

Status: Implemented; navigation behaviour revised by the [confirmed correction](./correction.md). Manual keypress testing remains pending.

## Contract

- [Intent](./intent.md)
- [Facts](./facts.md)
- [Fact metadata](./facts.meta.json)
- [Plan](./plan.md)
- [Dev log](./dev-log.md)

The accepted facts and plan, as amended by the [confirmed correction](./correction.md), are the contract. Interview and review files beside this package are provenance, not required execution inputs.

## Done when

- every accepted fact is implemented as specified
- every fact with automated verification has a passing check
- facts that a unit test cannot press in the Herdr client are recorded as manual
- config edits stay on the plugin lock and the existing patch path
- uninstall removes only bindings Mosaic created

## Launch

```text
/goal ai-artifacts/goals/mosaic-keyboard-navigation/goal.md
```
