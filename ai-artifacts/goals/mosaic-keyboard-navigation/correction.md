# Idle navigation correction

Confirmed in chat on 25 September 2026 after local testing. This supersedes the fixed-endpoint behaviour in facts 6 and 7 and steps 1 and 2 of the original plan. The earlier review files remain historical evidence.

- `Ctrl+.` advances through eligible agents newest-first and wraps.
- `Ctrl+,` advances through the same list oldest-first and wraps.
- Every press reads live agents. Blocked agents remain ahead of idle and done in newest-first order; oldest-first reverses that order. Working and unknown agents remain excluded.
- Live activity sequence numbers determine recency. Observed timestamps are the fallback when the host does not provide comparable sequence numbers for the list.
- With an unchanged first candidate, advance from the currently focused agent. Skip that agent if another is eligible.
- If an update changes the first candidate or its activity revision in the chosen direction, visit it immediately. Example: presses visit 1, 2, 3; agent 4 updates and moves to the front; the next `Ctrl+.` visits 4.
- Each direction remembers only its first candidate and activity revision, not a frozen list. Save progress under the plugin lock only after focus succeeds. A failed focus must remain retryable.
- With no other eligible agent, focus remains unchanged.

No binding changes are required for this correction. The request to remove the separate `herdr-workspace-nav` workaround remains pending; it is not the Vim navigation plugin.
