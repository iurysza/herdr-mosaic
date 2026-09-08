# Step 1 metadata-event barrier evidence

Generated against one disposable named Herdr server. No plugin was linked, no agent identity/lifecycle API was called, and no default-session socket was targeted.

## Isolation and scope

- Command exit: `0`; operational error: `None`.
- Isolated root: `/tmp/hm1-metadata-2m5snkia`.
- Default config/plugin hashes unchanged during this run: `True`.
- Metadata target: ordinary workspace `w1`, pane `w1:p1`.
- Metadata source: `step1-barrier`; exactly one token `step1_marker`; no TTL supplied.
- Discovery/test token values differ: `True` (`step1-barrier-discovery-1170270780053500` vs `step1-barrier-test-1170270780054208`).

## Payload discovery

- One reader subscribed to: `[{"type": "workspace.focused"}, {"type": "tab.focused"}, {"type": "pane.focused"}, {"type": "pane.updated"}, {"type": "workspace.metadata_updated"}, {"type": "workspace.updated"}]`.
- Subscription error: `None`.
- Discovery publish reply: `{'id': 'step1-1170271101003458', 'result': {'type': 'ok'}}`.
- A candidate event containing the exact token/value in actual event data was found: `True`.
- Matching event: `{'event_index': 3, 'frame_index': 4, 'received_monotonic_ns': 1170271302668916, 'event': 'workspace_metadata_updated', 'data': {'type': 'workspace_metadata_updated', 'workspace': {'active_tab_id': 'w1:t1', 'agent_status': 'unknown', 'focused': True, 'label': 'Step1-barrier-A', 'number': 1, 'pane_count': 1, 'tab_count': 1, 'tokens': {'step1_marker': 'step1-barrier-discovery-1170270780053500'}, 'workspace_id': 'w1'}}}`.
- Correlation details from actual event data: `{'token_name': 'step1_marker', 'token_value': 'step1-barrier-discovery-1170270780053500', 'source_in_event': None, 'workspace_id_in_event': 'w1'}`; the event may omit the source field, so the unique token value is the observed discriminator.
- Discovery frames are retained in the JSON evidence; no snapshot was used to infer marker correlation.

## One bounded interleaving test

- Externally acknowledged focus requests: `['B', 'C', 'A']`.
- Focus acknowledgements all succeeded: `True`.
- Marker publish followed B/C/A replies: `{'id': 'step1-1170271314467875', 'result': {'type': 'ok'}}`.
- Matching marker event: `{'event_index': 11, 'frame_index': 12, 'received_monotonic_ns': 1170271504736458, 'event': 'workspace_metadata_updated', 'data': {'type': 'workspace_metadata_updated', 'workspace': {'active_tab_id': 'w1:t1', 'agent_status': 'unknown', 'focused': True, 'label': 'Step1-barrier-A', 'number': 1, 'pane_count': 1, 'tab_count': 1, 'tokens': {'step1_marker': 'step1-barrier-test-1170270780054208'}, 'workspace_id': 'w1'}}}`.
- Correlation details from actual event data: `{'token_name': 'step1_marker', 'token_value': 'step1-barrier-test-1170270780054208', 'source_in_event': None, 'workspace_id_in_event': 'w1'}`.
- Checked focus event types: `['workspace_focused', 'tab_focused', 'pane_focused']`.
- Focus event frame positions by type: `[{'label': 'B', 'workspace_id': 'w2', 'tab_id': 'w2:t1', 'pane_id': 'w2:p1', 'frame_positions_by_type': {'workspace_focused': [5], 'tab_focused': [6], 'pane_focused': [7]}, 'positions_before_marker_by_type': {'workspace_focused': [5], 'tab_focused': [6], 'pane_focused': [7]}, 'event_types_before_marker': ['workspace_focused', 'tab_focused', 'pane_focused'], 'destination_established_before_marker': True, 'missing_event_types': [], 'all_frame_positions': [5, 6, 7]}, {'label': 'C', 'workspace_id': 'w3', 'tab_id': 'w3:t1', 'pane_id': 'w3:p1', 'frame_positions_by_type': {'workspace_focused': [9], 'tab_focused': [10], 'pane_focused': [11]}, 'positions_before_marker_by_type': {'workspace_focused': [9], 'tab_focused': [10], 'pane_focused': [11]}, 'event_types_before_marker': ['workspace_focused', 'tab_focused', 'pane_focused'], 'destination_established_before_marker': True, 'missing_event_types': [], 'all_frame_positions': [9, 10, 11]}, {'label': 'A', 'workspace_id': 'w1', 'tab_id': 'w1:t1', 'pane_id': 'w1:p1', 'frame_positions_by_type': {'workspace_focused': [], 'tab_focused': [], 'pane_focused': []}, 'positions_before_marker_by_type': {'workspace_focused': [], 'tab_focused': [], 'pane_focused': []}, 'event_types_before_marker': [], 'destination_established_before_marker': False, 'missing_event_types': ['workspace_focused', 'tab_focused', 'pane_focused'], 'all_frame_positions': []}]`; marker frame position: `12`.
- Destination establishment before marker (any unambiguous workspace/tab/pane event): `[('B', True, ['workspace_focused', 'tab_focused', 'pane_focused']), ('C', True, ['workspace_focused', 'tab_focused', 'pane_focused']), ('A', False, [])]`.
- Every acknowledged B/C/A destination was established before the matching marker: `False`.
- Focus remained on A while marking: before `w1:p1`, after `w1:p1`.
- No sleep, quiet-period, TTL, latest-snapshot inference, or reset was used as a barrier.

## Hypothesis result and limits

- Result for this disposable sequence: `blocked`.
- Limitation/blocker: `the unique test marker did not follow an unambiguous focus event for every externally acknowledged B/C/A destination; per-type positions are retained, and a destination is missing only when no workspace/tab/pane event establishes it before the marker`.
- A matching marker event can delimit only the exact observed sequence. It is not a universal Herdr ordering guarantee and does not establish ordering for other metadata sources, sessions, or event types.

## Cleanup

- Marker clear reply: `{'id': 'step1-1170271512220375', 'result': {'type': 'ok'}}`.
- The disposable server was stopped after cleanup; prior host probe files were not modified.

## Exact frames

The JSON sibling contains subscription messages, discovery frames, interleaving frames, replies, timestamps, and cleanup output.
