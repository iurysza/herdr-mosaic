# Plan

Bind Herdr's existing tab and agent-panel cyclers to the accepted chords, and replace the idle wrap cycle with two jumps over one shared list. Blocked agents rank ahead of idle and done. Setup writes bindings only when the action and the chord are free, and uninstall removes only bindings Mosaic created.

## Approach

Tab and agent-list navigation stay in Herdr. `keys.previous_tab` and `keys.next_tab` already wrap inside the current workspace. `keys.previous_agent` and `keys.next_agent` already wrap through the sidebar order on every press. While Mosaic's labelled view is active, that order is the view from `src/agents/view.ts`, including Activity, Spaces, and the current-workspace filter. Mosaic installs those four native chords. It does not reimplement the cycle.

`Ctrl + .` and `Ctrl + ,` stay plugin actions. They share one ranking in `src/agents/triage.ts`. The newest command focuses the first agent. The oldest command focuses the last. Neither command walks a cursor, and neither calls `agent.focus` when the chosen agent is already focused or the list is empty.

A blocked observation time is stored beside the existing settlement time. Entering `blocked` from another status records the time. An agent first seen already blocked has no blocked time. Settlement rules for `working` to `idle` or `done` stay as they are.

## Steps

### 1. Rank eligible agents

Files: `src/agents/tracker.ts`, `src/agents/triage.ts`, `tests/unit/tracker.test.ts`, `tests/unit/triage.test.ts`.

Add a blocked observation time to the settled record. Stamp it only on a transition into `blocked`. Leave `last_settled_at` unchanged, including the existing rule that `blocked` is not a completion.

Build one ordered list:

1. blocked agents with an observation time, newest first
2. blocked agents with no observation time
3. idle and done agents with a settlement time, newest first
4. idle and done agents with no settlement time

Pane id ascending is the tiebreak inside each group. Working and unknown agents are omitted. The list is the full `agent.list` result, not the sidebar filter.

`Ctrl + .` selects index 0. `Ctrl + ,` selects the last index. Both return no target when the list is empty or the selected agent is already focused.

Verification: unit tests for group order, missing times, pane-id ties, an already-focused newest or oldest agent, and an empty list. Tracker tests show a new blocked entry time without moving `last_settled_at`.

Covers `fact-6` and `fact-7`.

### 2. Focus the newest and oldest agents

Files: `src/agents/triage.ts`, `src/dispatch/catalog.ts`, `src/dispatch/main.ts`, `herdr-plugin.toml`, `tests/cli/triage.test.ts`.

Keep `next-idle-agent` as the newest jump. Add `oldest-idle-agent` for the other end. Both run under the plugin lock, read live agents, and call `agent.focus` only for a target that is not already focused. Stop reading and writing `idle_cycle_last_pane_id` for these commands. Leave the state field in place so older state files still load.

Update the manifest action copy for `next-idle-agent`, and add an `oldest-idle-agent` action with the same contexts. The two commands share the ranking from step 1.

Verification: CLI tests for newest, oldest, already focused, no eligible agent, blocked ahead of a newer idle agent, and an agent outside a current-workspace view still being eligible.

Covers `fact-6`, `fact-7`, and the shared-order part of `fact-10`.

### 3. Install and remove the chords

Files: `src/config/patch.ts`, `src/config/keybinds.ts`, `src/lifecycle/install.ts`, `src/lifecycle/uninstall.ts`, `src/lifecycle/doctor.ts`, `src/state/store.ts`, `tests/cli/keybind.test.ts`, `tests/unit/state.test.ts`.

All writes stay on the existing lock and `commitDoc` path.

Change the idle default from `prefix+.` to `ctrl+.`. When `idle_keybind_installed` is set and the live command key is still `prefix+.`, rewrite that key to `ctrl+.` if the chord is free. Update the stored key. If `ctrl+.` is taken, leave `prefix+.` and report the collision. If the live key is anything else, or Mosaic does not own the binding, leave it.

Add a managed `oldest-idle-agent` binding at `ctrl+,`, installed by setup with the other managed bindings. Install it only when the chord is free. Uninstall removes that command entry only when Mosaic's installed flag is set.

Add a native-key installer for:

| Action | Chord |
| --- | --- |
| `previous_tab` | `ctrl+[` |
| `next_tab` | `ctrl+]` |
| `previous_agent` | `ctrl+shift+[` |
| `next_agent` | `ctrl+shift+]` |

A chord is occupied when any `[[keys.command]]` entry or any `[keys]` action already uses it. Skip an action that already has a value. Skip a free action whose chord is occupied, and report which binding holds it. Record each chord Mosaic writes. On uninstall, unset that native key only when Mosaic recorded it and the live value is still that chord. Never record a pre-existing user value as Mosaic-owned.

Wire the native installer into `runInstall` after the managed keybind steps. Report the four native chords and both idle chords from `doctor`.

Verification: config fixtures through `herdr config check` for a fresh install, an owned `prefix+.` retarget, a customized idle key, occupied `ctrl+.`, occupied `ctrl+,`, a pre-set `previous_tab`, a chord already used by another command, and uninstall that removes only Mosaic's keys and restores an absent native key by deleting it.

Covers `fact-4`, `fact-8`, `fact-9`, `fact-10`, and `fact-11`. `fact-4` is the existing view definition tests in `tests/unit/view.test.ts` plus the assertion that setup binds `previous_agent` and `next_agent` rather than a second sort.

### 4. Describe the shortcuts

Files: `README.md`, `docs/actions.md`, `CHANGELOG.md`, `herdr-plugin.toml`.

Replace the `prefix+.` wrap description with the two jumps, the blocked-first order, and the four native chords. State that tab and agent-list wrap behaviour belongs to Herdr, and that a terminal which reports Ctrl+[ only as Escape will not run the previous-tab chord.

Verification: read the edited pages against the facts. The manifest test suite must still accept the new action.

Covers the user-facing half of `fact-1`, `fact-2`, `fact-3`, `fact-5`, and `fact-10`. Those four navigation facts stay manual for the keypress itself.

## Fact coverage

| Fact | Automated check |
| --- | --- |
| `fact-1` | Manual. Herdr `previous_tab` / `next_tab`. Setup writes the chords in step 3. |
| `fact-2` | Manual. Same Herdr actions are scoped to the focused workspace. |
| `fact-3` | Manual. Herdr `previous_agent` / `next_agent` read the live sidebar order. |
| `fact-4` | `tests/unit/view.test.ts` and the native binding fixture in step 3. |
| `fact-5` | Manual. Herdr's empty-list and missing-focus behaviour. |
| `fact-6` | `tests/unit/triage.test.ts`, `tests/unit/tracker.test.ts`, `tests/cli/triage.test.ts`. |
| `fact-7` | Same triage tests, plus the oldest command fixture. |
| `fact-8` | `tests/cli/keybind.test.ts`. |
| `fact-9` | `tests/cli/keybind.test.ts`. |
| `fact-10` | `tests/cli/keybind.test.ts` and `herdr config check` on the fixture. |
| `fact-11` | `tests/cli/keybind.test.ts`. |

## Risks

Ctrl+[ is distinct from Escape in Herdr's key model, and `herdr config check` on 0.8.2 accepts the chord. A terminal that sends only Escape for that key will not focus the previous tab. The binding stays `ctrl+[`.

Native agent cycling follows Mosaic's filter only while the labelled view is installed. Setup already installs that view. Clearing the view returns Herdr to its own panel order, which is still the sidebar the user is looking at.

The known ownership bugs in `ai-artifacts/goals/state-config-safety/issues.md` stay out of scope. This work must not mark a pre-existing binding as installed and then delete it on uninstall.

`idle_cycle_last_pane_id` becomes unused by these commands. Leaving the field avoids a state migration.

## Assumptions

An agent already blocked when Mosaic first records it has no blocked time until a later transition into `blocked`. That matches the accepted rule for missing times.

Full uninstall of a Mosaic-created idle command removes the command entry. `prefix+.` on that entry was an earlier Mosaic value, so uninstall does not put `prefix+.` back.

No blocking product decision remains.
