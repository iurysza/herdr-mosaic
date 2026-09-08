Evidence is complete: seven idle proof panes can close; only protected `w5S:pH` stays. The inventory below is the artifact for the configured path.

```markdown
# Herdr w5S pane inventory — 2026-09-06

Workspace `w5S` (`herdr-window-manager`), 8 panes / 8 tabs. Inspected with explicit IDs only. No pane was closed, focused, renamed, prompted, or moved. No code, config, session, worktree, or live runtime state was changed.

Current work in this parent session: bundle Chromatic colours/identity/tint, current spaces and agent sidebar rendering, and existing Pane Layouts into one plugin in `/Users/iurysouza/dev/personal/tools/herdr-window-manager`. Last-focus is deferred. Themed-agent routing stays separate. Plugin implementation has not started here.

## Review
- Correct: Live topology matches the parent snapshot. All seven candidates are idle Pi agents (~23h), foreground-only `pi`/`node` (no extra child work), with recoverable JSONL sessions and durable proof files.
- Blocker: none for this inventory. Do not close `w5S:pH`.
- Note: Closing a live pane would kill that Pi process; JSONL and untracked `probes/` trees remain only if left on disk. Unique 2026-09-05 user answers in `w5S:p5` were not copied into the goal package.

## Conclusion

**Keep:** `w5S:pH` / `w5S:tC` only (protected inventory/cleanup pane).

**Close (live pane not needed):** `w5S:p5`, `w5S:p6`, `w5S:p7`, `w5S:p8`, `w5S:pD`, `w5S:pE`, `w5S:pF`.

**Uncertain:** none.

Keep the saved sessions and untracked proof trees. Do not delete worktrees or `probes/` when closing panes.

## All eight panes

| Pane / tab | Labels | State | Purpose / latest outcome | Decision | Reason |
|---|---|---|---|---|---|
| `w5S:p5` / `w5S:t5` | pane+tab: Review Event Ordering; agent `herdr_wm_coordinator` | idle ~23h; fg `pi` gpt-6-astra xhigh; no extra children | Old goal coordinator. Host gate blocked. User: plugin-only; native focus via Ctrl+E; keep coloured titles. Interrupted before writing those choices into the goal package. | **close live pane** | Last-focus now deferred; this parent superseded the old coordinator. Session holds unique answers. |
| `w5S:p6` / `w5S:t6` | pane+tab: Audit Subscription Semantics; agent `herdr_wm_validator` | idle ~23h; fg `pi` gpt-5.6-luna xhigh | Independent source audit of Herdr 0.8.2 subscriptions/focus drain. Confirmed no mutation-complete focus history. | **close live pane** | Finished read-only audit; last-focus deferred. |
| `w5S:p7` / `w5S:t7` | tab: Refine Metadata Barrier Probe; pane: Verify Metadata Barrier; agent `herdr_wm_host` | idle ~24h; fg `pi` gpt-5.6-luna xhigh | Metadata-marker barrier probe. Hypothesis **blocked**: destination A missing before marker frame 12. | **close live pane** | Evidence in canonical `probes/`; last-focus deferred. |
| `w5S:p8` / `w5S:t8` | tab: Review Sidebar Proof; pane: Review UI Proof; agent `herdr_wm_dotfiles` | idle ~23h; fg `pi` gpt-5.6-sol high | Independent review of sidebar/popup proof. Corrected overclaims; waited on a gate this parent is not continuing. | **close live pane** | Review complete; reports exist in the sidebar worktree. |
| `w5S:pD` / `w5S:t9` | tab: Finalize Proof Report; pane: Finalize Capability Report; agent `herdr_wm_ui` | idle ~23h; fg `pi` gpt-5.6-sol high | Isolated sidebar/popup STEP1 proof, then relinquished writer to Astra. | **close live pane** | Writer already handed off; evidence preserved. |
| `w5S:pE` / `w5S:tA` | tab: Review Native Last Pane; pane: Inspect Last Pane Source; agent `herdr_wm_focus_astra` | idle ~23h; fg `pi` gpt-6-astra high | Native `last_pane` source check. Thin RPC wrapper insufficient. | **close live pane** | Last-focus deferred; `native-last-pane.md` exists. |
| `w5S:pF` / `w5S:tB` | tab: Prove Sidebar Capabilities; pane: Build Sidebar Proof; agent `herdr_wm_sidebar_astra` | idle ~23h; fg `pi` gpt-6-astra high | `rows_by_agent` selects detected kind, not `display_agent`. Cold coloured-title gap unresolved. | **close live pane** | Proof finished; live pane not required to read `REPORT.md`. |
| `w5S:pH` / `w5S:tC` | tab: Clean Up Panes; pane: Inventory And Close Panes | this inventory session; focused; terminal `term_65ad43ad6740c240` | Current cleanup / later plugin-bundle parent. | **keep** | Protected anchor. Do not close. |

## Per-candidate notes

### `w5S:p5` — close live pane
- Agent: `herdr_wm_coordinator`. Terminal: `term_65ac019fc299c20a`.
- Session (mtime 2026-09-05 21:28 local): `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T17-56-26-652Z_01a072b6-ef9c-7880-b912-e1f9c052cbc3.jsonl`
- Recent: Astra/Luna proofs blocked the old last-focus/sidebar contracts. `ask_user` answers: **Keep it plugin-only**; freeform **agree. but use ctrl+e**; **Keep coloured titles**. User then asked “what are you doing right now. whats the limitation”. Assistant: coloured titles may be blank until first successful publish; no automatic fallback row. Turn aborted before goal-package amendments. Idle since.
- Chat-only (not in `goal.md` / `dev-log.md`): plugin-only; Ctrl+E native toggle; keep coloured titles / accept startup blanks. Current parent **defers last-focus**, so the Ctrl+E choice is superseded for this bundle. Coloured-title choice still matters as recovered context.
- Artifacts: `/Users/iurysouza/dev/personal/dotfiles/ai-artifacts/goals/herdr-window-manager/dev-log.md` (stops at host-gate block); `/Users/iurysouza/.local/state/agent-workspaces/herdr-window-manager/reopen/coordinator-brief.md`.
- Live pane not needed. Keep the JSONL.

### `w5S:p6` — close live pane
- Agent: `herdr_wm_validator`. Terminal: `term_65ac019fc600020b`.
- Session (mtime 2026-09-05 21:16): `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T17-56-17-477Z_01a072b6-cbc5-79c5-b639-700d2860014c.jsonl`
- Recent: last user asked a pinned-source audit at `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`. Assistant: typed subscriptions only; per-kind cursors; focus mutation returns before `sync_focus_events`; headless drain can drop intermediate focus. Also installed uv 0.11.29 earlier. No pending question.
- Artifacts: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-astra-focus/probes/evidence/subscription-semantics/result.md`.
- Work is last-focus/event-history. Deferred. Live pane not needed.

### `w5S:p7` — close live pane
- Agent: `herdr_wm_host`. Terminal: `term_65ac019fc9ac920c`.
- Session (mtime 2026-09-05 20:59): `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T17-56-20-574Z_01a072b6-d7de-7b75-b540-c331d8f46bdd.jsonl`
- Recent: corrected distinct discovery/test markers; any unambiguous destination event counts. Single rerun: B frames `[5,6,7]`, C `[9,10,11]`, A none before marker 12. Hypothesis blocked. Stopped.
- Artifacts (canonical, untracked):
  - `/Users/iurysouza/dev/personal/tools/herdr-window-manager/probes/step1_metadata_barrier.py`
  - `/Users/iurysouza/dev/personal/tools/herdr-window-manager/probes/evidence/step1-metadata-barrier.md`
  - `/Users/iurysouza/dev/personal/tools/herdr-window-manager/probes/evidence/step1-metadata-barrier.json`
  - `/Users/iurysouza/dev/personal/tools/herdr-window-manager/probes/evidence/step1-metadata-barrier-before-final-fix.md`
  - `/Users/iurysouza/dev/personal/tools/herdr-window-manager/probes/step1_host_capabilities.py`
- Last-focus deferred. Live pane not needed. Preserve untracked `probes/`.

### `w5S:p8` — close live pane
- Agent: `herdr_wm_dotfiles` (later read-only UI reviewer). Terminal: `term_65ac019fcce8620d`.
- Session (mtime 2026-09-05 21:03): `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T17-56-23-608Z_01a072b6-e3b8-7e63-9940-77f43fbe8e58.jsonl`
- Recent: user dropped Ctrl+Tab in favour of Ctrl+E. Independent review: enhanced cold start blank; publication works; native fallback readable in fixture; static appended fallback duplicates identity; focused popup outside ordinary topology; `publishThemedIdentity` publishes tokens only, not `display_agent`; conditional rows were then untested. Waited on coordinator/user. Reviewer once could not reopen PNGs; they exist now.
- Artifacts: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-sidebar-proof/probes/evidence-sidebar-proof/step1-sidebar-popup-ui.md` plus captures `01`–`07`.
- Useful as files, not as a live pane.

### `w5S:pD` — close live pane
- Agent: `herdr_wm_ui`. Terminal: `term_65ac0ceebe53a218`.
- Session (mtime 2026-09-05 21:05): `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T18-47-02-907Z_01a072e5-43fb-7e0a-bbad-4f5eabb18d5d.jsonl`
- Recent: STEP1 UI proof, then claim corrections, then **writer ownership relinquished** to Astra. Cleanup of disposable server passed.
- Artifacts: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-sidebar-proof/probes/evidence-sidebar-proof/` (`step1-sidebar-popup-ui.md` / `.json`, PNG/txt/json captures, server logs). Probe: `.../probes/step1_sidebar_popup_ui.py`.
- Live pane is a finished read-only reference.

### `w5S:pE` — close live pane
- Agent: `herdr_wm_focus_astra`. Terminal: `term_65ac1120d423b219`.
- Session (mtime 2026-09-05 21:17): `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T19-05-49-027Z_01a072f6-72e3-7c40-87a0-58eb4d1cfffc.jsonl`
- Recent: reproduced empty vs typed subscriptions; then native last-pane source check. Findings: stores `workspace_id` + internal `PaneId` (not `TerminalId`); true popups excluded, overlays not; no staging filter; cold start clears previous focus; `last_pane_via_api` is not a public RPC. Stopped. No unfinished approval.
- Artifacts:
  - `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-astra-focus/probes/evidence/subscription-semantics/native-last-pane.md`
  - `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-astra-focus/probes/evidence/subscription-semantics/result.md`
  - siblings: `summary.json`, `schema.json`, `typed/`, `empty/`
- Last-focus deferred. Live pane not needed.

### `w5S:pF` — close live pane
- Agent: `herdr_wm_sidebar_astra`. Terminal: `term_65ac1120d7b1f21a`.
- Session (mtime 2026-09-05 21:30): `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T19-05-49-006Z_01a072f6-72ce-7b2a-8a55-7045d05616d4.jsonl`
- Recent: `rows_by_agent` keys off detected kind, not `display_agent`. User asked “what is this?”. Assistant: switching native→coloured titles by presentation metadata does not work; blank-name problem unresolved; no live changes. Idle since.
- Artifacts: `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-sidebar-proof/probes/evidence-conditional-final/REPORT.md` (plus frames and `conditional-sidebar.json`). Earlier dirs `evidence-conditional-first/` and `evidence-conditional-control/` intact.
- Residual: final run recorded live `config.toml` hash drift and did not claim default files unchanged. Registry/socket receipts matched. Not a reason to keep the pane.
- Sidebar proof is in-scope for the bundle as **files**. Live pane not required.

### `w5S:pH` — keep (protected)
- Pane `w5S:pH`, tab `w5S:tC`, terminal `term_65ad43ad6740c240`.
- Session: `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-06T17-57-08-377Z_01a077dd-ee99-7acd-bc91-a4ea022e9b2a.jsonl`
- This inventory/cleanup parent. Unconditionally keep.

## Stable identities for proposed closures

Re-list `herdr pane get <id>` before any close. Do not close if `terminal_id` or session path differs.

| Pane | Tab | Agent name | terminal_id | Session path |
|---|---|---|---|---|
| `w5S:p5` | `w5S:t5` | `herdr_wm_coordinator` | `term_65ac019fc299c20a` | `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T17-56-26-652Z_01a072b6-ef9c-7880-b912-e1f9c052cbc3.jsonl` |
| `w5S:p6` | `w5S:t6` | `herdr_wm_validator` | `term_65ac019fc600020b` | `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T17-56-17-477Z_01a072b6-cbc5-79c5-b639-700d2860014c.jsonl` |
| `w5S:p7` | `w5S:t7` | `herdr_wm_host` | `term_65ac019fc9ac920c` | `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T17-56-20-574Z_01a072b6-d7de-7b75-b540-c331d8f46bdd.jsonl` |
| `w5S:p8` | `w5S:t8` | `herdr_wm_dotfiles` | `term_65ac019fcce8620d` | `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T17-56-23-608Z_01a072b6-e3b8-7e63-9940-77f43fbe8e58.jsonl` |
| `w5S:pD` | `w5S:t9` | `herdr_wm_ui` | `term_65ac0ceebe53a218` | `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T18-47-02-907Z_01a072e5-43fb-7e0a-bbad-4f5eabb18d5d.jsonl` |
| `w5S:pE` | `w5S:tA` | `herdr_wm_focus_astra` | `term_65ac1120d423b219` | `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T19-05-49-027Z_01a072f6-72e3-7c40-87a0-58eb4d1cfffc.jsonl` |
| `w5S:pF` | `w5S:tB` | `herdr_wm_sidebar_astra` | `term_65ac1120d7b1f21a` | `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-05T19-05-49-006Z_01a072f6-72ce-7b2a-8a55-7045d05616d4.jsonl` |

Protected, do not close: `w5S:pH` / `w5S:tC` / `term_65ad43ad6740c240` / `/Users/iurysouza/.pi/agent/sessions/--Users-iurysouza-dev-personal-tools-herdr-window-manager--/2026-09-06T17-57-08-377Z_01a077dd-ee99-7acd-bc91-a4ea022e9b2a.jsonl`

## Preserve independently of pane close

Untracked proof trees (do not delete):

- Canonical: `/Users/iurysouza/dev/personal/tools/herdr-window-manager/probes/` (also untracked `AGENTS.md`, `ai-artifacts/`; `CLAUDE.md` deleted in git status).
- `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-astra-focus` branch `proof/astra-focus` @ `910c3da`, untracked `probes/`.
- `/Users/iurysouza/dev/personal/worktrees/herdr-window-manager-sidebar-proof` branch `proof/sidebar-capabilities` @ `910c3da`, untracked `probes/`.

Related sources for the upcoming bundle, not owned by these panes: Chromatic clone HEAD `910c3daf04124c91afe4c0f01a09c0442658ead5` on `implementation`; Pane Layouts `/Users/iurysouza/dev/personal/tools/herdr-pane-layouts` @ `0ef0a8d5d463757f06037551fc1f5ef6dfde478d`.

Old goal `/Users/iurysouza/dev/personal/dotfiles/ai-artifacts/goals/herdr-window-manager/goal.md` still includes `toggle-last-focus` / Ctrl+Tab. That is **not** this parent’s current scope.

## Attestation

No panes were closed. No code, configuration, plugins, sessions, worktrees, or live runtime state were modified. Inspection used `HERDR_ENV=1` and explicit pane IDs (`herdr workspace get`, `tab list`, `pane list/get/process-info/read`, plus read-only `ps`/`git`/`python3` on session files).
```