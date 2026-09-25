# Dev Log

Status: Not started

## 2026-09-25

Implemented the approved plan.

- Eligible jumps rank blocked agents ahead of idle and done. Entering `blocked` from another known status records `last_blocked_at` and leaves `last_settled_at` unchanged. An agent first seen already blocked has no blocked time.
- `next-idle-agent` focuses the newest eligible agent. `oldest-idle-agent` focuses the oldest. Neither walks a cursor or calls `agent.focus` when that end is already focused or the list is empty.
- Setup retargets a Mosaic-owned `prefix+.` idle binding to `ctrl+.` when that chord is free, adds `ctrl+,` for the oldest jump, and binds Herdr `previous_tab`, `next_tab`, `previous_agent`, and `next_agent` only when the action and chord are free. Uninstall removes only bindings Mosaic recorded.

Checks: `bun run typecheck`, `bun run lint`, and `bun run test` passed, 296 tests. `tests/herdr/config-check.test.ts` accepted `ctrl+[`, `ctrl+]`, `ctrl+shift+[`, `ctrl+shift+]`, `ctrl+.`, and `ctrl+,` with the installed Herdr binary.

Manual: fact-1, fact-2, fact-3, and fact-5 are Herdr client keypresses. They were not pressed in a live session. Setup writes the chords, and the client behaviour is the installed Herdr cycler.

Remaining: none in the approved plan.

## 2026-09-25: advance on every press

The user corrected the endpoint behaviour after testing and confirmed newest-first traversal on `Ctrl+.` and oldest-first traversal on `Ctrl+,`. See [the correction](./correction.md), which supersedes the earlier fixed-endpoint requirements.

The shared selector now advances from live focus and wraps. Each direction remembers its first candidate and activity revision. A changed first candidate takes priority on the next press. Live `state_change_seq` values determine order when available across the list; observed times remain the fallback. Progress is persisted under the existing lock only after successful focus. Uninstall clears the new progress field.

Regression tests exercise repeated presses in both directions, wrapping, the exact 1 → 2 → 3 → new 4 example, a previously visited agent updating again, external focus, missing agents, malformed saved progress, and retry after a focus failure. No live focus was moved during verification.

Checks passed: typecheck, lint, 301 unit/CLI tests, 20 runtime tests, build, 4 artifact tests, and `git diff --check`.

Rebuilt `dist/mosaic` in the confirmed locally linked checkout. The previous executable is backed up at `/tmp/mosaic-navigation-binary.CKiMdj/mosaic`. Verified compiled help describes both cycles and the existing live `ctrl+.` / `ctrl+,` bindings still target their respective actions. No binding or settings files were changed for this correction.

Remaining: manual keypress testing. The separate request to remove `herdr-workspace-nav` and free the Shift+Bracket chords is still pending.
