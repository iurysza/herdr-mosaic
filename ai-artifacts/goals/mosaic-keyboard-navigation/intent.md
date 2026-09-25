# Intent

Status: facts accepted. The plan is awaiting review. No execution approval is included.

## Outcome

Mosaic users move between tabs, through the sidebar's displayed agent list, and to settled agents from the keyboard. The shortcuts are direct Control chords: `Ctrl + [` and `Ctrl + ]` for tabs, `Ctrl + Shift + [` and `Ctrl + Shift + ]` for the displayed agent list, `Ctrl + .` for the newest eligible agent, and `Ctrl + ,` for the oldest. Tab and agent-list navigation wrap. The two agent jumps go to the ends of one shared list.

## Audience and problem

Mosaic users need to move through tabs and agents while staying in their keyboard workflow. Agent navigation must follow the sidebar's selected sort order rather than an unrelated ordering.

The user's example shows the sidebar in Activity mode. Starting from the current agent, repeated navigation should move through the list the sidebar is showing after each press.

## Scope

| Shortcut | Behaviour |
| --- | --- |
| `Ctrl + [` | Focus the previous tab in the current workspace |
| `Ctrl + ]` | Focus the next tab in the current workspace |
| `Ctrl + Shift + [` | Focus the previous agent in the sidebar's live order |
| `Ctrl + Shift + ]` | Focus the next agent in the sidebar's live order |
| `Ctrl + .` | Focus the newest eligible agent |
| `Ctrl + ,` | Focus the oldest eligible agent |

The bracket shortcuts are direct Control combinations, not Herdr prefix sequences. Opening bracket moves backward. Closing bracket moves forward.

Tab navigation moves between tabs in the current workspace, including tabs that contain no agent. It wraps. A workspace with only the current tab leaves focus unchanged.

Agent-list navigation starts from the focused agent when that agent is in the displayed list. It follows the sidebar's current sort, Activity or Spaces, and its workspace filter, all workspaces or the current workspace. Each press reads the live order. It wraps. An empty list, or a list containing only the focused agent, leaves focus unchanged. When the focused pane is outside that list, the next shortcut focuses the first displayed agent and the previous shortcut focuses the last.

Eligible agents for the two jump shortcuts are `blocked`, `idle`, and `done`. `blocked` outranks `idle` and `done`. Among blocked agents, a more recently observed entry into `blocked` ranks newer. Among idle and done agents, a more recently observed settlement ranks newer. An agent with no observed time for its group ranks after agents in that group that have one. Pane id is the final tiebreak. `Ctrl + .` focuses the newest agent in that order. `Ctrl + ,` focuses the oldest. If the chosen agent is already focused, focus stays unchanged. Working and unknown agents are excluded. These jumps include agents outside the sidebar filter. There is no shortcut that steps backward through this list.

## Non-goals

- changing the existing sidebar sort definitions or introducing another sort mode
- adding a separate most-recently-focused history instead of following sidebar order
- freezing an Activity sequence across presses
- creating, closing, moving, or restarting tabs, panes, or agents
- adding an agent picker or redesigning the sidebar
- adding a shortcut that steps backward through eligible agents
- limiting the idle jumps to the sidebar filter
- implementing the broader state and config safety backlog as part of this goal
- changing live Herdr configuration or installing bindings during planning

## Constraints

- Preserve user-owned bindings and unrelated config. An occupied shortcut must not be silently replaced.
- Retarget the newest-agent shortcut only when Mosaic owns the current `prefix+.` binding and `ctrl+.` is free. A customized or user-owned binding stays as it is. If `ctrl+.` is taken, keep the existing binding and warn.
- Bind `ctrl+,` for the oldest eligible agent only when that chord is free. If it is taken, leave the existing binding and warn.
- Keep binding changes reversible. Record the previous value of every key Mosaic writes, including a key that was absent, and restore that value on uninstall. Do not treat a pre-existing user binding as Mosaic-owned.
- Route config edits through `src/config/patch.ts` under the plugin lock.
- Reuse Herdr's tab and agent-panel cycling where it already matches this behaviour. Keep one idle-agent implementation.
- Herdr 0.8.2 accepts the chord strings `ctrl+[`, `ctrl+]`, `ctrl+shift+[`, `ctrl+shift+]`, `ctrl+.`, and `ctrl+,`. In Herdr's key model, `ctrl+[` is Control plus `[`, which is distinct from Escape. A terminal that reports Ctrl+[ only as Escape will not trigger the tab shortcut.
- Test against disposable config, state, and sockets. Live setup needs separate approval.
- Account for the [known binding ownership and recovery issues](../state-config-safety/issues.md) before extending binding installation. This goal does not approve reproducing those defects and does not require fixing unrelated backlog items.

## Decisions

The user confirmed:

- the outcome, shortcuts, wrapping, and non-goals above
- live sidebar order on every agent-list press
- retargeting a Mosaic-owned `prefix+.` idle binding to `ctrl+.` when that chord is free
- `Ctrl + .` always jumps to the newest eligible agent
- `blocked` agents outrank `idle` and `done`
- `Ctrl + ,` jumps to the oldest eligible agent
- tab navigation stays in the current workspace
- agent-list navigation follows the sidebar's active workspace filter and sort
- an empty list, or a list containing only the current item, leaves focus unchanged

## Existing behaviour checked

[View definitions](../../../src/agents/view.ts) provide Activity and Spaces sorting, with separate all-workspaces and current-workspace scopes. Activity sorts by attention, then state-change sequence, followed by workspace, tab, and pane order. Mosaic publishes that view with a label, so Herdr treats it as the sidebar order.

Herdr 0.8.2 `keys.previous_tab` and `keys.next_tab` focus tabs in the current workspace and wrap. `keys.previous_agent` and `keys.next_agent` focus the previous and next agent in the sidebar order and wrap. While a labelled plugin view is active, that order is the plugin view, including its filter. [Herdr issue 964](https://github.com/herdrdev/herdr/issues/964) was closed after the reporter found they had been pressing the tab cycle. The maintainer's regression covers `next_agent` reaching an agent in another workspace when that agent is in the panel.

[Keybinding configuration](../../../src/config/keybinds.ts) currently gives `iurysza.mosaic.next-idle-agent` the default binding `prefix+.`. The requested `Ctrl + .` is a different shortcut. The current installer leaves an existing command binding unchanged, so retargeting an owned `prefix+.` binding is new work.

[Idle navigation](../../../src/agents/triage.ts) currently selects `idle` and `done` agents, orders them by settled time, skips the focused agent, and wraps. That cycle changes under the decisions above. [Status tracking](../../../src/agents/tracker.ts) records a settlement time only for a transition from `working` to `idle` or `done`. A blocked observation time is new. `agent.list` still returns every agent while a sidebar view is active, so these jumps are not the sidebar list.

`herdr config check` on 0.8.2 accepts `ctrl+[`, `ctrl+]`, `ctrl+shift+[`, `ctrl+shift+]`, `ctrl+.`, and `ctrl+,` as command chords.

## Assumptions

None. The earlier workspace, filter, and empty-list assumptions were accepted in the interview.

## Open questions

None.
