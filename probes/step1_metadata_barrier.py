#!/usr/bin/env python3
"""Probe whether owned metadata events can delimit prior focus events.

This is a bounded, isolated step-one probe. It uses one events.subscribe reader,
ordinary RPC connections for focus and metadata, one ordinary workspace, and one
metadata token. It never links or runs the plugin and never addresses the default
Herdr session.
"""

from __future__ import annotations

import argparse
import json
import shutil
import socket
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

# Keep the isolation implementation in one place. This import is deliberately
# limited to the allowlisted probe helper; this module owns its evidence only.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from step1_host_capabilities import (  # noqa: E402
    COMMAND_TIMEOUT,
    REPO,
    IsolatedHerdr,
    default_file_receipts,
    pane_id_from_create,
    parse_json,
    run_command,
    snapshot,
    tab_id_from_create,
    workspace_id_from_create,
)


EVIDENCE_DIR = REPO / "probes" / "evidence"
EVIDENCE_JSON = EVIDENCE_DIR / "step1-metadata-barrier.json"
EVIDENCE_MD = EVIDENCE_DIR / "step1-metadata-barrier.md"
# IsolatedHerdr owns the session name; its disposable root keeps repeated runs separate.
SESSION = "step1-probe"
SOURCE = "step1-barrier"
TOKEN = "step1_marker"
WAIT_TIMEOUT = 3.0
SUBSCRIPTIONS = [
    {"type": "workspace.focused"},
    {"type": "tab.focused"},
    {"type": "pane.focused"},
    {"type": "pane.updated"},
    {"type": "workspace.metadata_updated"},
    {"type": "workspace.updated"},
]


class ProbeFailure(RuntimeError):
    pass


class MetadataEventReader:
    """One ordered reader with focus and metadata-event candidates."""

    def __init__(self, socket_path: Path) -> None:
        self.socket_path = socket_path
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._condition = threading.Condition()
        self._socket: Optional[socket.socket] = None
        self._messages: list[dict[str, Any]] = []
        self._events: list[dict[str, Any]] = []
        self._frames: list[dict[str, Any]] = []
        self._error: Optional[str] = None
        self._thread = threading.Thread(
            target=self._run, name="step1-metadata-events", daemon=True
        )

    def start(self, timeout: float = COMMAND_TIMEOUT) -> None:
        self._thread.start()
        if not self._ready.wait(timeout):
            raise ProbeFailure("metadata events.subscribe did not acknowledge")

    def _run(self) -> None:
        request_id = "step1-metadata-events"
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(0.2)
            self._socket = sock
            sock.connect(str(self.socket_path))
            payload = {
                "id": request_id,
                "method": "events.subscribe",
                "params": {"subscriptions": SUBSCRIPTIONS},
            }
            sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
            buffer = b""
            while not self._stop.is_set():
                try:
                    chunk = sock.recv(65536)
                except socket.timeout:
                    continue
                if not chunk:
                    break
                buffer += chunk
                while b"\n" in buffer:
                    raw, buffer = buffer.split(b"\n", 1)
                    if not raw.strip():
                        continue
                    message = json.loads(raw.decode("utf-8"))
                    received = time.monotonic_ns()
                    with self._condition:
                        frame = {
                            "index": len(self._frames),
                            "received_monotonic_ns": received,
                            "kind": "event" if "event" in message else "response",
                            "message": message,
                        }
                        self._messages.append(message)
                        self._frames.append(frame)
                        if message.get("id") == request_id:
                            if "error" in message:
                                self._error = "events.subscribe: %s" % message["error"]
                            self._ready.set()
                        elif "event" in message:
                            self._events.append(
                                {
                                    "event_index": len(self._events),
                                    "frame_index": frame["index"],
                                    "received_monotonic_ns": received,
                                    "event": message.get("event"),
                                    "data": message.get("data"),
                                }
                            )
                        self._condition.notify_all()
        except Exception as exc:  # pragma: no cover - emitted as evidence
            with self._condition:
                self._error = "events.subscribe reader: %s" % exc
                self._ready.set()
                self._condition.notify_all()
        finally:
            if self._socket is not None:
                try:
                    self._socket.close()
                except OSError:
                    pass

    def event_count(self) -> int:
        with self._condition:
            return len(self._events)

    def frame_count(self) -> int:
        with self._condition:
            return len(self._frames)

    def frames_since(self, index: int) -> list[dict[str, Any]]:
        with self._condition:
            return list(self._frames[index:])

    def wait_for(
        self,
        predicate: Callable[[dict[str, Any]], bool],
        event_index: int,
        timeout: float = WAIT_TIMEOUT,
    ) -> Optional[dict[str, Any]]:
        deadline = time.monotonic() + timeout
        with self._condition:
            while True:
                for event in self._events[event_index:]:
                    if predicate(event):
                        return dict(event)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(remaining)

    def close(self) -> None:
        self._stop.set()
        if self._socket is not None:
            try:
                self._socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                self._socket.close()
            except OSError:
                pass
        if self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def as_dict(self) -> dict[str, Any]:
        with self._condition:
            return {
                "subscription_messages": list(self._messages),
                "events": list(self._events),
                "frames": list(self._frames),
                "reader_error": self._error,
            }

    @property
    def error(self) -> Optional[str]:
        with self._condition:
            return self._error


def rpc_result(reply: Any) -> bool:
    return isinstance(reply, dict) and "error" not in reply and "result" in reply


def safe_rpc(herdr: IsolatedHerdr, method: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        return herdr.rpc(method, params)
    except Exception as exc:  # preserve operational detail in evidence
        return {"probe_exception": "%s: %s" % (type(exc).__name__, exc)}


def marker_match_details(value: Any, token_value: str) -> Optional[dict[str, Any]]:
    """Return correlation details only from the received event payload."""
    if isinstance(value, dict):
        tokens = value.get("tokens")
        if isinstance(tokens, dict) and tokens.get(TOKEN) == token_value:
            return {
                "token_name": TOKEN,
                "token_value": token_value,
                "source_in_event": value.get("source"),
                "workspace_id_in_event": value.get("workspace_id"),
            }
        for child in value.values():
            details = marker_match_details(child, token_value)
            if details is not None:
                return details
    elif isinstance(value, list):
        for child in value:
            details = marker_match_details(child, token_value)
            if details is not None:
                return details
    return None


def marker_event(event: dict[str, Any], token_value: str) -> bool:
    return marker_match_details(event.get("data"), token_value) is not None


def focused_pane(snapshot_value: dict[str, Any]) -> Optional[str]:
    for pane in snapshot_value.get("panes", []):
        if pane.get("focused"):
            return pane.get("pane_id")
    return None


FOCUS_EVENT_TYPES = ("workspace_focused", "tab_focused", "pane_focused")


def focus_event_positions(
    frames: list[dict[str, Any]],
    targets: list[dict[str, Optional[str]]],
    marker_frame_position: Optional[int],
) -> list[dict[str, Any]]:
    result = []
    for target in targets:
        positions_by_type: dict[str, list[int]] = {}
        for event_type in FOCUS_EVENT_TYPES:
            positions_by_type[event_type] = [
                frame.get("index")
                for frame in frames
                if frame.get("kind") == "event"
                and (frame.get("message") or {}).get("event") == event_type
                and (
                    ((frame.get("message") or {}).get("data") or {}).get(
                        "workspace_id" if event_type == "workspace_focused" else
                        "tab_id" if event_type == "tab_focused" else "pane_id"
                    )
                    == target.get(
                        "workspace_id" if event_type == "workspace_focused" else
                        "tab_id" if event_type == "tab_focused" else "pane_id"
                    )
                )
            ]
        before_by_type = {
            event_type: [
                position
                for position in positions_by_type[event_type]
                if marker_frame_position is not None and position < marker_frame_position
            ]
            for event_type in FOCUS_EVENT_TYPES
        }
        result.append(
            {
                "label": target.get("label"),
                "workspace_id": target.get("workspace_id"),
                "tab_id": target.get("tab_id"),
                "pane_id": target.get("pane_id"),
                "frame_positions_by_type": positions_by_type,
                "positions_before_marker_by_type": before_by_type,
                "event_types_before_marker": [
                    event_type
                    for event_type in FOCUS_EVENT_TYPES
                    if before_by_type[event_type]
                ],
                "destination_established_before_marker": any(
                    before_by_type.values()
                ),
                "missing_event_types": [
                    event_type
                    for event_type in FOCUS_EVENT_TYPES
                    if not positions_by_type[event_type]
                ],
                "all_frame_positions": sorted(
                    position
                    for positions in positions_by_type.values()
                    for position in positions
                ),
            }
        )
    return result


def write_evidence(evidence: dict[str, Any]) -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    EVIDENCE_JSON.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")

    discovery = evidence.get("payload_discovery", {})
    test = evidence.get("interleaving_test", {})
    barrier = evidence.get("hypothesis", {})
    lines = [
        "# Step 1 metadata-event barrier evidence",
        "",
        "Generated against one disposable named Herdr server. No plugin was linked, no agent identity/lifecycle API was called, and no default-session socket was targeted.",
        "",
        "## Isolation and scope",
        "",
        f"- Command exit: `{evidence.get('exit_code')}`; operational error: `{evidence.get('operational_error')}`.",
        f"- Isolated root: `{evidence.get('isolation', {}).get('root')}`.",
        f"- Default config/plugin hashes unchanged during this run: `{evidence.get('isolation', {}).get('default_files_unchanged')}`.",
        f"- Metadata target: ordinary workspace `{evidence.get('target', {}).get('workspace_id')}`, pane `{evidence.get('target', {}).get('pane_id')}`.",
        f"- Metadata source: `{SOURCE}`; exactly one token `{TOKEN}`; no TTL supplied.",
        f"- Discovery/test token values differ: `{evidence.get('marker_values_differ')}` (`{evidence.get('discovery_token_value')}` vs `{evidence.get('test_token_value')}`).",
        "",
        "## Payload discovery",
        "",
        f"- One reader subscribed to: `{json.dumps(SUBSCRIPTIONS, sort_keys=True)}`.",
        f"- Subscription error: `{discovery.get('subscription_error')}`.",
        f"- Discovery publish reply: `{discovery.get('publish_reply')}`.",
        f"- A candidate event containing the exact token/value in actual event data was found: `{discovery.get('marker_event_found')}`.",
        f"- Matching event: `{discovery.get('marker_event')}`.",
        f"- Correlation details from actual event data: `{discovery.get('marker_correlation')}`; the event may omit the source field, so the unique token value is the observed discriminator.",
        "- Discovery frames are retained in the JSON evidence; no snapshot was used to infer marker correlation.",
        "",
        "## One bounded interleaving test",
        "",
        f"- Externally acknowledged focus requests: `{[item.get('label') for item in test.get('external_focuses', [])]}`.",
        f"- Focus acknowledgements all succeeded: `{test.get('focus_acknowledged')}`.",
        f"- Marker publish followed B/C/A replies: `{test.get('marker_publish_reply')}`.",
        f"- Matching marker event: `{test.get('marker_event')}`.",
        f"- Correlation details from actual event data: `{test.get('marker_correlation')}`.",
        f"- Checked focus event types: `{test.get('focus_event_types_checked')}`.",
        f"- Focus event frame positions by type: `{test.get('focus_event_positions')}`; marker frame position: `{test.get('marker_frame_position')}`.",
        f"- Destination establishment before marker (any unambiguous workspace/tab/pane event): `{[(item.get('label'), item.get('destination_established_before_marker'), item.get('event_types_before_marker')) for item in test.get('focus_event_positions', [])]}`.",
        f"- Every acknowledged B/C/A destination was established before the matching marker: `{test.get('all_destinations_established_before_marker')}`.",
        f"- Focus remained on A while marking: before `{test.get('focused_before_marker')}`, after `{test.get('focused_after_marker')}`.",
        "- No sleep, quiet-period, TTL, latest-snapshot inference, or reset was used as a barrier.",
        "",
        "## Hypothesis result and limits",
        "",
        f"- Result for this disposable sequence: `{barrier.get('result')}`.",
        f"- Limitation/blocker: `{barrier.get('blocker')}`.",
        "- A matching marker event can delimit only the exact observed sequence. It is not a universal Herdr ordering guarantee and does not establish ordering for other metadata sources, sessions, or event types.",
        "",
        "## Cleanup",
        "",
        f"- Marker clear reply: `{evidence.get('cleanup', {}).get('clear_reply')}`.",
        "- The disposable server was stopped after cleanup; prior host probe files were not modified.",
        "",
        "## Exact frames",
        "",
        "The JSON sibling contains subscription messages, discovery frames, interleaving frames, replies, timestamps, and cleanup output.",
    ]
    EVIDENCE_MD.write_text("\n".join(lines) + "\n")


def main(argv: Optional[list[str]] = None) -> int:
    global EVIDENCE_DIR, EVIDENCE_JSON, EVIDENCE_MD
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--evidence-dir",
        type=Path,
        default=EVIDENCE_DIR,
        help="write this probe's JSON and Markdown evidence here",
    )
    options = parser.parse_args(argv)
    EVIDENCE_DIR = options.evidence_dir
    EVIDENCE_JSON = EVIDENCE_DIR / "step1-metadata-barrier.json"
    EVIDENCE_MD = EVIDENCE_DIR / "step1-metadata-barrier.md"

    started = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    commands: list[Any] = []
    default_before = default_file_receipts()
    root = Path(tempfile.mkdtemp(prefix="hm1-metadata-", dir="/tmp"))
    (root / "config" / "herdr").mkdir(parents=True)
    (root / "state").mkdir(parents=True)
    herdr_bin = shutil.which("herdr")
    if not herdr_bin:
        raise ProbeFailure("herdr is not in PATH")
    herdr = IsolatedHerdr(herdr_bin, root, commands)
    reader: Optional[MetadataEventReader] = None
    discovery_marker_value = "step1-barrier-discovery-%d" % time.monotonic_ns()
    test_marker_value = "step1-barrier-test-%d" % time.monotonic_ns()
    if discovery_marker_value == test_marker_value:
        raise ProbeFailure("discovery and test marker values must differ")
    marker_published = False
    exit_code = 0
    evidence: dict[str, Any] = {
        "probe": "step1-metadata-barrier",
        "started_at_utc": started,
        "repo": str(REPO),
        "herdr_bin": herdr_bin,
        "session": SESSION,
        "source": SOURCE,
        "token": TOKEN,
        "discovery_token_value": discovery_marker_value,
        "test_token_value": test_marker_value,
        "marker_values_differ": discovery_marker_value != test_marker_value,
        "commands": [],
        "isolation": {"root": str(root)},
    }

    try:
        default_config = run_command([herdr_bin, "--default-config"], herdr.env, REPO)
        commands.append(default_config)
        if default_config.returncode != 0:
            raise ProbeFailure("herdr --default-config failed")
        herdr.config_path.write_text(default_config.stdout)
        config_check = herdr.run(["config", "check"])
        evidence["config_check_exit"] = config_check.returncode
        if config_check.returncode != 0:
            raise ProbeFailure("isolated config check failed")

        herdr.start()
        workspace_results = []
        panes: dict[str, str] = {}
        tabs: dict[str, str] = {}
        workspaces: dict[str, str] = {}
        for label in ("A", "B", "C"):
            result = herdr.session_run(
                [
                    "workspace",
                    "create",
                    "--cwd",
                    str(REPO),
                    "--label",
                    "Step1-barrier-" + label,
                    "--no-focus",
                ]
            )
            workspace_results.append(result.as_dict())
            workspace_id = workspace_id_from_create(result)
            tab_id = tab_id_from_create(result)
            pane_id = pane_id_from_create(result)
            if not workspace_id or not tab_id or not pane_id:
                raise ProbeFailure("could not parse ordinary workspace/tab/pane %s" % label)
            workspaces[label] = workspace_id
            tabs[label] = tab_id
            panes[label] = pane_id
        evidence["target"] = {
            "workspace_id": workspaces["A"],
            "pane_id": panes["A"],
            "workspace_create_commands": workspace_results,
            "workspaces": workspaces,
            "tabs": tabs,
            "panes": panes,
        }

        reader = MetadataEventReader(herdr.socket_path)
        reader.start()
        evidence["payload_discovery"] = {
            "subscriptions": SUBSCRIPTIONS,
            "subscription_error": reader.error,
        }
        if reader.error:
            evidence["hypothesis"] = {
                "result": "blocked",
                "blocker": "events.subscribe rejected the focus/metadata candidate subscriptions: %s" % reader.error,
            }
        else:
            focus_a_reply = safe_rpc(herdr, "pane.focus", {"pane_id": panes["A"]})
            discovery_focused_before = focused_pane(snapshot(herdr))
            discovery_frame_start = reader.frame_count()
            discovery_event_start = reader.event_count()
            discovery_reply = safe_rpc(
                herdr,
                "workspace.report_metadata",
                {
                    "workspace_id": workspaces["A"],
                    "source": SOURCE,
                    "tokens": {TOKEN: discovery_marker_value},
                },
            )
            if rpc_result(discovery_reply):
                marker_published = True
            discovery_match = reader.wait_for(
                lambda event: marker_event(event, discovery_marker_value),
                discovery_event_start,
            )
            discovery_frames = reader.frames_since(discovery_frame_start)
            evidence["payload_discovery"].update(
                {
                    "focus_a_reply": focus_a_reply,
                    "focused_before_publish": discovery_focused_before,
                    "publish_reply": discovery_reply,
                    "marker_event_found": discovery_match is not None,
                    "marker_event": discovery_match,
                    "marker_correlation": (
                        marker_match_details(discovery_match.get("data"), discovery_marker_value)
                        if discovery_match is not None
                        else None
                    ),
                    "frames": discovery_frames,
                }
            )

            if discovery_match is None:
                evidence["hypothesis"] = {
                    "result": "blocked",
                    "blocker": "no subscribed focus/metadata event carried the exact source/token/value in actual event data; marker correlation is unavailable",
                }
            else:
                clear_discovery = safe_rpc(
                    herdr,
                    "workspace.report_metadata",
                    {
                        "workspace_id": workspaces["A"],
                        "source": SOURCE,
                        "tokens": {TOKEN: None},
                    },
                )
                evidence["payload_discovery"]["clear_before_test_reply"] = clear_discovery

                external_targets = [
                    {
                        "label": label,
                        "workspace_id": workspaces[label],
                        "tab_id": tabs[label],
                        "pane_id": panes[label],
                    }
                    for label in ("B", "C", "A")
                ]
                test_frame_start = reader.frame_count()
                test_event_start = reader.event_count()
                external_focuses = []
                for target in external_targets:
                    pane_id = target["pane_id"]
                    label = target["label"]
                    request_started = time.monotonic_ns()
                    reply = safe_rpc(herdr, "pane.focus", {"pane_id": pane_id})
                    reply_received = time.monotonic_ns()
                    external_focuses.append(
                        {
                            "label": label,
                            "pane_id": pane_id,
                            "request_started_monotonic_ns": request_started,
                            "reply_received_monotonic_ns": reply_received,
                            "reply_duration_ms": round(
                                (reply_received - request_started) / 1_000_000, 3
                            ),
                            "reply": reply,
                            "acknowledged": rpc_result(reply),
                        }
                    )
                focus_acknowledged = all(item["acknowledged"] for item in external_focuses)
                focused_before_marker = focused_pane(snapshot(herdr))
                test_marker_reply = safe_rpc(
                    herdr,
                    "workspace.report_metadata",
                    {
                        "workspace_id": workspaces["A"],
                        "source": SOURCE,
                        "tokens": {TOKEN: test_marker_value},
                    },
                )
                if rpc_result(test_marker_reply):
                    marker_published = True
                test_match = reader.wait_for(
                    lambda event: marker_event(event, test_marker_value),
                    test_event_start,
                )
                test_frames = reader.frames_since(test_frame_start)
                marker_frame_position = (
                    test_match.get("frame_index") if test_match is not None else None
                )
                event_positions = focus_event_positions(
                    test_frames, external_targets, marker_frame_position
                )
                all_before = (
                    focus_acknowledged
                    and marker_frame_position is not None
                    and all(
                        item["destination_established_before_marker"]
                        for item in event_positions
                    )
                )
                focused_after_marker = focused_pane(snapshot(herdr))
                evidence["interleaving_test"] = {
                    "external_focuses": external_focuses,
                    "focus_acknowledged": focus_acknowledged,
                    "focused_before_marker": focused_before_marker,
                    "marker_publish_reply": test_marker_reply,
                    "marker_event": test_match,
                    "marker_correlation": (
                        marker_match_details(test_match.get("data"), test_marker_value)
                        if test_match is not None
                        else None
                    ),
                    "marker_frame_position": marker_frame_position,
                    "focus_event_types_checked": list(FOCUS_EVENT_TYPES),
                    "focus_event_positions": event_positions,
                    "all_destinations_established_before_marker": all_before,
                    "focused_after_marker": focused_after_marker,
                    "frames": test_frames,
                }
                if all_before:
                    evidence["hypothesis"] = {
                        "result": "sequence_observed",
                        "blocker": "none for this disposable A/B/C sequence; this does not establish a universal host ordering guarantee",
                    }
                else:
                    evidence["hypothesis"] = {
                        "result": "blocked",
                        "blocker": "the unique test marker did not follow an unambiguous focus event for every externally acknowledged B/C/A destination; per-type positions are retained, and a destination is missing only when no workspace/tab/pane event establishes it before the marker",
                    }
    except Exception as exc:
        exit_code = 1
        evidence["operational_error"] = "%s: %s" % (type(exc).__name__, exc)
    finally:
        cleanup_reply: Any = None
        if marker_published:
            cleanup_reply = safe_rpc(
                herdr,
                "workspace.report_metadata",
                {
                    "workspace_id": evidence.get("target", {}).get("workspace_id"),
                    "source": SOURCE,
                    "tokens": {TOKEN: None},
                },
            )
        evidence["cleanup"] = {"clear_reply": cleanup_reply}
        if reader is not None:
            evidence["reader_final"] = reader.as_dict()
            reader.close()
        herdr.stop()
        evidence["isolation"].update(
            {
                "home": str(root),
                "xdg_config": str(root / "config"),
                "xdg_data": str(root / "data"),
                "xdg_cache": str(root / "cache"),
                "xdg_state": str(root / "state"),
                "xdg_runtime": str(root / "runtime"),
                "config_path": str(herdr.config_path),
                "default_files_before": default_before,
                "default_files_after": default_file_receipts(),
            }
        )
        evidence["isolation"]["default_files_unchanged"] = (
            evidence["isolation"]["default_files_before"]
            == evidence["isolation"]["default_files_after"]
        )
        evidence["commands"] = [result.as_dict() for result in commands]
        evidence["exit_code"] = exit_code
        evidence["completed_at_utc"] = datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )
        write_evidence(evidence)

    print(str(EVIDENCE_MD), file=sys.stderr if exit_code else sys.stdout)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
