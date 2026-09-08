# Step 1 metadata-event barrier evidence

Generated against one disposable named Herdr server. No plugin was linked, no agent identity/lifecycle API was called, and no default-session socket was targeted.

## Isolation and scope

- Command exit: `0`; operational error: `None`.
- Isolated root: `/tmp/hm1-metadata-9xrm2vha`.
- Default config/plugin hashes unchanged during this run: `True`.
- Metadata target: ordinary workspace `w1`, pane `w1:p1`.
- Metadata source: `step1-barrier`; exactly one token `step1_marker`; no TTL supplied.

## Payload discovery

- One reader subscribed to: `[{"type": "workspace.focused"}, {"type": "tab.focused"}, {"type": "pane.focused"}, {"type": "pane.updated"}, {"type": "workspace.metadata_updated"}, {"type": "workspace.updated"}]`.
- Subscription error: `None`.
- Discovery publish reply: `{'id': 'step1-1169860063550166', 'result': {'type': 'ok'}}`.
- A candidate event containing the exact source/token/value in actual event data was found: `True`.
- Matching event: `{'event_index': 3, 'frame_index': 4, 'received_monotonic_ns': 1169860157399000, 'event': 'workspace_metadata_updated', 'data': {'type': 'workspace_metadata_updated', 'workspace': {'active_tab_id': 'w1:t1', 'agent_status': 'unknown', 'focused': True, 'label': 'Step1-barrier-A', 'number': 1, 'pane_count': 1, 'tab_count': 1, 'tokens': {'step1_marker': 'step1-barrier-1169859857257625'}, 'workspace_id': 'w1'}}}`.
- Correlation details from actual event data: `{'token_name': 'step1_marker', 'token_value': 'step1-barrier-1169859857257625', 'source_in_event': None, 'workspace_id_in_event': 'w1'}`; the event may omit the source field, so the unique token value is the observed discriminator.
- Discovery frames are retained in the JSON evidence; no snapshot was used to infer marker correlation.

## One bounded interleaving test

- Externally acknowledged focus requests: `['B', 'C', 'A']`.
- Focus acknowledgements all succeeded: `True`.
- Marker publish followed B/C/A replies: `{'id': 'step1-1169860166452541', 'result': {'type': 'ok'}}`.
- Matching marker event: `{'event_index': 11, 'frame_index': 12, 'received_monotonic_ns': 1169860364890750, 'event': 'workspace_metadata_updated', 'data': {'type': 'workspace_metadata_updated', 'workspace': {'active_tab_id': 'w1:t1', 'agent_status': 'unknown', 'focused': True, 'label': 'Step1-barrier-A', 'number': 1, 'pane_count': 1, 'tab_count': 1, 'tokens': {'step1_marker': 'step1-barrier-1169859857257625'}, 'workspace_id': 'w1'}}}`.
- Correlation details from actual event data: `{'token_name': 'step1_marker', 'token_value': 'step1-barrier-1169859857257625', 'source_in_event': None, 'workspace_id_in_event': 'w1'}`.
- Focus event frame positions: `[{'label': 'B', 'pane_id': 'w2:p1', 'frame_positions': [7]}, {'label': 'C', 'pane_id': 'w3:p1', 'frame_positions': [11]}, {'label': 'A', 'pane_id': 'w1:p1', 'frame_positions': []}]`; marker frame position: `12`.
- All observed B/C/A focus events preceded the matching marker event: `False`.
- Focus remained on A while marking: before `w1:p1`, after `w1:p1`.
- No sleep, quiet-period, TTL, latest-snapshot inference, or reset was used as a barrier.

## Hypothesis result and limits

- Result for this disposable sequence: `blocked`.
- Limitation/blocker: `the matching metadata marker did not prove every externally acknowledged B/C/A focus event preceded it on the same reader`.
- A matching marker event can delimit only the exact observed sequence. It is not a universal Herdr ordering guarantee and does not establish ordering for other metadata sources, sessions, or event types.

## Cleanup

- Marker clear reply: `{'id': 'step1-1169860371921875', 'result': {'type': 'ok'}}`.
- The disposable server was stopped after cleanup; prior host probe files were not modified.

## Exact frames

The JSON sibling contains subscription messages, discovery frames, interleaving frames, replies, timestamps, and cleanup output.
