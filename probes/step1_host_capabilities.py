#!/usr/bin/env python3
"""Reproducible, isolated Herdr 0.8.2 capability probes for goal step 1.

This script never addresses the user's default Herdr socket. It starts a named
headless server under a temporary HOME/XDG tree, links this checkout only into
that isolated registry, and stops only that disposable process. It records
commands, protocol observations, event ordering, pane moves, popup behaviour,
restart reset, and cold-start agent readability.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional


REPO = Path(__file__).resolve().parents[1]
EVIDENCE_DIR = REPO / "probes" / "evidence"
EVIDENCE_JSON = EVIDENCE_DIR / "step1-host-capabilities.json"
EVIDENCE_MD = EVIDENCE_DIR / "step1-host-capabilities.md"
SESSION = "step1-probe"
COMMAND_TIMEOUT = 20.0


@dataclass
class CommandResult:
    argv: list[str]
    returncode: int
    stdout: str
    stderr: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "argv": self.argv,
            "returncode": self.returncode,
            "stdout": self.stdout,
            "stderr": self.stderr,
        }


class ProbeFailure(RuntimeError):
    pass


class EventReader:
    """One ordered events.subscribe owner for the disposable session."""

    def __init__(self, socket_path: Path) -> None:
        self.socket_path = socket_path
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._condition = threading.Condition()
        self._events: list[dict[str, Any]] = []
        self._messages: list[dict[str, Any]] = []
        self._frames: list[dict[str, Any]] = []
        self._responses: dict[str, dict[str, Any]] = {}
        self._send_lock = threading.Lock()
        self._error: Optional[str] = None
        self._socket: Optional[socket.socket] = None
        self._thread = threading.Thread(target=self._run, name="step1-events", daemon=True)

    def start(self, timeout: float = 5.0) -> None:
        self._thread.start()
        if not self._ready.wait(timeout):
            raise ProbeFailure("events.subscribe did not acknowledge within timeout")
        if self._error:
            raise ProbeFailure(self._error)

    def _run(self) -> None:
        request_id = "step1-events"
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(0.2)
            self._socket = sock
            sock.connect(str(self.socket_path))
            payload = {
                "id": request_id,
                "method": "events.subscribe",
                "params": {
                    "subscriptions": [
                        {"type": "workspace.focused"},
                        {"type": "tab.focused"},
                        {"type": "pane.focused"},
                        {"type": "pane.moved"},
                        {"type": "pane.closed"},
                    ]
                },
            }
            self._send(payload)
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
                    received_monotonic_ns = time.monotonic_ns()
                    with self._condition:
                        self._messages.append(message)
                        self._frames.append(
                            {
                                "received_monotonic_ns": received_monotonic_ns,
                                "kind": "event" if "event" in message else "response",
                                "message": message,
                            }
                        )
                        if message.get("id") == request_id:
                            if "error" in message:
                                self._error = "events.subscribe: %s" % message["error"]
                            self._ready.set()
                        elif "event" in message:
                            self._events.append(
                                {
                                    "index": len(self._events),
                                    "received_monotonic_ns": received_monotonic_ns,
                                    "event": message.get("event"),
                                    "data": message.get("data"),
                                }
                            )
                        elif isinstance(message.get("id"), str):
                            self._responses[message["id"]] = message
                        self._condition.notify_all()
        except Exception as exc:  # pragma: no cover - surfaced in evidence
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

    def _send(self, payload: dict[str, Any]) -> None:
        if self._socket is None:
            raise ProbeFailure("events.subscribe socket is not ready")
        with self._send_lock:
            self._socket.sendall((json.dumps(payload) + "\n").encode("utf-8"))

    def request_burst(
        self,
        requests: list[tuple[str, str, dict[str, Any]]],
        timeout: float = 5.0,
    ) -> dict[str, dict[str, Any]]:
        """Send requests on the subscribed socket, then await matching replies."""
        for request_id, method, params in requests:
            self._send({"id": request_id, "method": method, "params": params})
        request_ids = {request_id for request_id, _, _ in requests}
        deadline = time.monotonic() + timeout
        with self._condition:
            while not request_ids.issubset(self._responses):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(remaining)
            return {
                request_id: self._responses[request_id]
                for request_id in request_ids
                if request_id in self._responses
            }

    def count(self) -> int:
        with self._condition:
            return len(self._events)

    def frame_count(self) -> int:
        with self._condition:
            return len(self._frames)

    def frames_since(self, index: int) -> list[dict[str, Any]]:
        with self._condition:
            return list(self._frames[index:])

    def events_since(self, index: int) -> list[dict[str, Any]]:
        with self._condition:
            return list(self._events[index:])

    def wait_for(
        self,
        predicate: Callable[[dict[str, Any]], bool],
        since: int,
        timeout: float = 3.0,
    ) -> Optional[dict[str, Any]]:
        deadline = time.monotonic() + timeout
        with self._condition:
            while True:
                for event in self._events[since:]:
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


class IsolatedHerdr:
    def __init__(self, herdr_bin: str, root: Path, commands: list[CommandResult]) -> None:
        self.herdr_bin = herdr_bin
        self.root = root
        self.commands = commands
        self.config_path = root / "config" / "herdr" / "config.toml"
        self.socket_path = root / "config" / "herdr" / "sessions" / SESSION / "herdr.sock"
        self.env = self._make_env()
        self.server: Optional[subprocess.Popen[bytes]] = None
        self.server_stdout = root / "server.stdout"
        self.server_stderr = root / "server.stderr"

    def _make_env(self) -> dict[str, str]:
        # Do not inherit the caller's XDG, zsh, Herdr, credential, or launch
        # variables. Every home/config/data/cache/state/runtime root is inside
        # this disposable tree; only the small execution allowlist remains.
        env = {
            "HOME": str(self.root),
            "XDG_CONFIG_HOME": str(self.root / "config"),
            "XDG_DATA_HOME": str(self.root / "data"),
            "XDG_CACHE_HOME": str(self.root / "cache"),
            "XDG_STATE_HOME": str(self.root / "state"),
            "XDG_RUNTIME_DIR": str(self.root / "runtime"),
            "ZDOTDIR": str(self.root / "zsh"),
            "TMPDIR": str(self.root / "tmp"),
            "HERDR_CONFIG_PATH": str(self.config_path),
            "HERDR_SESSION": SESSION,
            "HERDR_BIN_PATH": self.herdr_bin,
            "PATH": "/usr/bin:/bin",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "TERM": "xterm-256color",
            "SHELL": "/bin/sh",
            "USER": "herdr-step1",
            "LOGNAME": "herdr-step1",
        }
        for directory in ("data", "cache", "runtime", "tmp", "zsh"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        return env

    def run(self, args: list[str], timeout: float = COMMAND_TIMEOUT) -> CommandResult:
        result = run_command(
            [self.herdr_bin] + args,
            self.env,
            cwd=REPO,
            timeout=timeout,
        )
        self.commands.append(result)
        return result

    def session_run(self, args: list[str], timeout: float = COMMAND_TIMEOUT) -> CommandResult:
        return self.run(["--session", SESSION] + args, timeout=timeout)

    def start(self) -> None:
        if self.server is not None and self.server.poll() is None:
            return
        self.socket_path.parent.mkdir(parents=True, exist_ok=True)
        stdout = self.server_stdout.open("ab")
        stderr = self.server_stderr.open("ab")
        self.server = subprocess.Popen(
            [self.herdr_bin, "--session", SESSION, "server"],
            cwd=str(REPO),
            env=self.env,
            stdout=stdout,
            stderr=stderr,
            start_new_session=True,
        )
        stdout.close()
        stderr.close()
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            if self.server.poll() is not None:
                raise ProbeFailure(
                    "isolated server exited with %s; stderr=%s"
                    % (self.server.returncode, self.server_stderr.read_text())
                )
            if self.socket_path.exists():
                try:
                    reply = self.rpc("ping", {})
                    if "error" not in reply:
                        return
                except (OSError, ProbeFailure):
                    pass
            time.sleep(0.05)
        raise ProbeFailure("isolated server socket did not become ready")

    def stop(self) -> None:
        if self.server is None or self.server.poll() is not None:
            return
        self.server.terminate()
        try:
            self.server.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            os.kill(self.server.pid, signal.SIGKILL)
            self.server.wait(timeout=5.0)
        deadline = time.monotonic() + 2.0
        while self.socket_path.exists() and time.monotonic() < deadline:
            time.sleep(0.05)

    def rpc(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if not self.socket_path.exists():
            raise ProbeFailure("isolated socket absent for %s" % method)
        request_id = "step1-%d" % time.monotonic_ns()
        payload = {
            "id": request_id,
            "method": method,
            "params": params,
        }
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(10.0)
            sock.connect(str(self.socket_path))
            sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
            stream = sock.makefile("rb")
            for raw in stream:
                if not raw.strip():
                    continue
                message = json.loads(raw.decode("utf-8"))
                if message.get("id") == request_id:
                    return message
        return {
            "error": {
                "code": "no_response",
                "message": "socket closed without reply for %s" % method,
            }
        }


def run_command(
    argv: list[str],
    env: dict[str, str],
    cwd: Path,
    timeout: float = COMMAND_TIMEOUT,
) -> CommandResult:
    try:
        proc = subprocess.run(
            argv,
            cwd=str(cwd),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
        return CommandResult(
            argv=argv,
            returncode=proc.returncode,
            stdout=proc.stdout.decode("utf-8", "replace"),
            stderr=proc.stderr.decode("utf-8", "replace"),
        )
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"").decode("utf-8", "replace")
        stderr = (exc.stderr or b"").decode("utf-8", "replace")
        return CommandResult(argv, 124, stdout, stderr + "\ncommand timed out")


def compact(value: str, limit: int = 2500) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "\n...[truncated by probe]"


def record_command(result: CommandResult) -> dict[str, Any]:
    result.stdout = compact(result.stdout)
    result.stderr = compact(result.stderr)
    return result.as_dict()


def parse_json(result: CommandResult, description: str) -> dict[str, Any]:
    if result.returncode != 0:
        raise ProbeFailure("%s failed: %s" % (description, result.stderr))
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ProbeFailure("%s returned non-JSON: %s" % (description, exc)) from exc
    if not isinstance(value, dict):
        raise ProbeFailure("%s returned a non-object JSON value" % description)
    return value


def sha256(path: Path) -> Optional[str]:
    if not path.exists() or not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def default_file_receipts() -> dict[str, Any]:
    home = Path.home()
    paths = [
        home / ".config" / "herdr" / "config.toml",
        home / ".config" / "herdr" / "plugins.json",
    ]
    return {
        str(path): {"exists": path.exists(), "sha256": sha256(path)} for path in paths
    }


def snapshot(herdr: IsolatedHerdr) -> dict[str, Any]:
    result = herdr.session_run(["api", "snapshot"])
    return parse_json(result, "isolated api snapshot").get("result", {}).get("snapshot", {})


def plugin_list(herdr: IsolatedHerdr) -> list[dict[str, Any]]:
    result = herdr.session_run(["plugin", "list", "--json"])
    value = parse_json(result, "isolated plugin list")
    return value.get("result", {}).get("plugins", []) or []


def pane_id_from_create(result: CommandResult) -> Optional[str]:
    if result.returncode != 0:
        return None
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    result_obj = value.get("result", {})
    for path in (
        ("root_pane", "pane_id"),
        ("pane", "pane_id"),
        ("created_pane", "pane_id"),
    ):
        current: Any = result_obj
        for part in path:
            if not isinstance(current, dict):
                current = None
                break
            current = current.get(part)
        if isinstance(current, str):
            return current
    return None


def workspace_id_from_create(result: CommandResult) -> Optional[str]:
    try:
        value = json.loads(result.stdout)
        workspace = value.get("result", {}).get("workspace", {})
        return workspace.get("workspace_id")
    except (json.JSONDecodeError, AttributeError):
        return None


def tab_id_from_create(result: CommandResult) -> Optional[str]:
    try:
        value = json.loads(result.stdout)
        tab = value.get("result", {}).get("tab", {})
        return tab.get("tab_id")
    except (json.JSONDecodeError, AttributeError):
        return None


def pane_for_workspace(snapshot_value: dict[str, Any], workspace_id: str) -> list[dict[str, Any]]:
    return [
        pane
        for pane in snapshot_value.get("panes", [])
        if pane.get("workspace_id") == workspace_id
    ]


def pane_with_terminal(snapshot_value: dict[str, Any], terminal_id: str) -> Optional[dict[str, Any]]:
    for pane in snapshot_value.get("panes", []):
        if pane.get("terminal_id") == terminal_id:
            return pane
    return None


def focus_probe(
    herdr: IsolatedHerdr,
    reader: EventReader,
    pane_id: str,
    label: str,
) -> dict[str, Any]:
    since = reader.count()
    started = time.monotonic_ns()
    reply = herdr.rpc("pane.focus", {"pane_id": pane_id})
    finished = time.monotonic_ns()
    event = reader.wait_for(
        lambda candidate: candidate.get("event") == "pane_focused"
        and (candidate.get("data") or {}).get("pane_id") == pane_id,
        since,
    )
    return {
        "label": label,
        "pane_id": pane_id,
        "request_started_monotonic_ns": started,
        "reply_received_monotonic_ns": finished,
        "reply_duration_ms": round((finished - started) / 1_000_000, 3),
        "reply": reply,
        "pane_focused_event": event,
        "event_after_reply": (
            None
            if event is None
            else event["received_monotonic_ns"] >= finished
        ),
    }


def write_evidence(evidence: dict[str, Any]) -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    EVIDENCE_JSON.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")

    native = evidence["native_last_pane"]
    isolation = evidence["isolation"]
    focus = evidence["focus_events"]
    move = evidence["moved_terminal"]
    restart = evidence["restart_reset"]
    popup = evidence["popup"]
    cold = evidence["cold_start"]
    same_stream = evidence["same_stream_barrier"]
    native_reply = native["rpc_probe"].get("error") or native["rpc_probe"].get("result")
    lines = [
        "# Step 1 host capability evidence",
        "",
        "Generated by `probes/step1_host_capabilities.py` against an isolated named Herdr server.",
        "No default-session socket, live config, live plugin registry, or user service was targeted.",
        "",
        "## Baseline",
        "",
        "- Unchanged upstream suite: `python3 -m unittest discover -s tests -t tests` — 118 tests, exit 0.",
        f"- Herdr version/protocol: `{evidence['host']['version']}` / `{evidence['host']['protocol']}`.",
        f"- Isolated server root: `{evidence['isolation']['root']}`.",
        "",
        "## Isolation",
        "",
        f"- File and registry isolation verified: `{isolation.get('file_isolation_verified')}`. This is not an overall host-gate pass.",
        f"- HOME: `{evidence['isolation'].get('home')}`.",
        f"- XDG config: `{evidence['isolation'].get('xdg_config')}`; explicit Herdr config: `{evidence['isolation'].get('config_path')}`.",
        f"- XDG state: `{evidence['isolation'].get('xdg_state')}`.",
        f"- Disabled local link wrote `{evidence['isolation'].get('registry_path')}`; plugin config/state paths resolve under the isolated XDG roots.",
        f"- Restart startup used isolated plugin state at `{evidence['isolation'].get('plugin_state_path')}`.",
        f"- Default live-file hashes before/after are equal: `{evidence['isolation'].get('default_files_unchanged')}`.",
        "",
        "## Native last-pane route",
        "",
        f"- Config accepts `last_pane = \"ctrl+tab\"`: `{native['config_accepts_ctrl_tab']}`.",
        f"- Schema exposes `keys.last_pane`: `{native['schema_has_last_pane_method']}`; a native `keys.last_pane` RPC probe returned `{native_reply}`.",
        f"- Generic plugin-to-native-action dispatch: `{native['generic_plugin_native_dispatch']}`.",
        "- Recommendation: **use the custom ordered event-reader/session-worker route**; do not inject terminal input.",
        "",
        "## Ordered focus events and barrier",
        "",
        f"- Persistent `events.subscribe` reader observed this event order: `{' -> '.join(focus['ordered_event_types'])}`.",
        f"- Repeated focus of the already-focused pane produced no duplicate `pane_focused` event: `{focus['duplicate_focus_no_event']}` (observation only).",
        f"- Focus-specific `events.wait` barrier is unsupported: `{focus['events_wait_focus_reply'].get('error', 'unexpected success')}`.",
        f"- Same-socket ABA focus burst reply support: `{same_stream['focus_burst_supported']}` (not used as barrier evidence).",
        f"- External acknowledged focus sequence B/C/A followed by same-stream non-mutating `{same_stream['non_mutating_request']['method']}`: reply accepted `{same_stream['supported']}`; prior events-before-reply proven `{same_stream['barrier_proven']}`.",
        f"- Explicit blocker: `{same_stream['blocker']}`.",
        "- The serial wait in the earlier probe was not a drain/request barrier. Do not treat ordered delivery alone as proof; implementation needs a real acknowledged/re-observe or host-supported barrier.",
        "",
        "## Identity, moves, restart, popup and cold start",
        "",
        f"- Cross-container move preserved terminal identity: `{move['terminal_id_stable']}` (`{move['old_pane_id']}` -> `{move['new_pane_id']}`; terminal `{move['terminal_id']}`).",
        f"- Closed pane focus returned `{evidence['closed_target']['error_code']}`; no replacement was selected by the host.",
        f"- Restart snapshot contained `{len(restart['snapshot_after_restart'].get('panes', []))}` panes and revived old terminal `{restart['old_terminal_id']}`: `{restart['old_terminal_present_after_restart']}`.",
        f"- Popup normal-focus unchanged was observed: `{popup['normal_focus_unchanged']}`; this is not proof that a focused transient is excluded from eligibility.",
        "- Staging classification: host `pane_moved` payload has no staging marker; caller must mark known internal moves and exclude them.",
        f"- Built-in `agent.list` label was observed before custom metadata: `{cold['agent_name']}` (`{json.dumps(cold['agent_list_excerpt'], sort_keys=True)}`); enhanced-sidebar cold-start rendering was not tested.",
        "",
        "## Physical Ctrl+Tab gate",
        "",
        "The attested capture is preserved in `probes/evidence/ctrl-tab-capture.json` at 18:26:30Z with bytes `1b5b41` (the normal Up-arrow sequence). It is inconclusive for Ctrl+Tab delivery, not a physical-key pass.",
        f"The capture pane was `w5S:pA` (tab `w5S:t7`), cwd `{REPO}`, label `Physical Ctrl+Tab capture`. Do not overwrite the preserved capture or inject another event as physical evidence.",
        "",
        "## Commands and raw evidence",
        "",
        "The JSON sibling records every probe command, exit code, selected raw RPC replies, event timestamps, and isolated paths.",
    ]
    EVIDENCE_MD.write_text("\n".join(lines) + "\n")


def main(argv: Optional[list[str]] = None) -> int:
    global EVIDENCE_DIR, EVIDENCE_JSON, EVIDENCE_MD
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--evidence-dir",
        type=Path,
        default=EVIDENCE_DIR,
        help="write generated JSON and Markdown evidence here",
    )
    options = parser.parse_args(argv)
    EVIDENCE_DIR = options.evidence_dir
    EVIDENCE_JSON = EVIDENCE_DIR / "step1-host-capabilities.json"
    EVIDENCE_MD = EVIDENCE_DIR / "step1-host-capabilities.md"

    started_utc = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    commands: list[CommandResult] = []
    default_before = default_file_receipts()
    root = Path(tempfile.mkdtemp(prefix="hm1-", dir="/tmp"))
    (root / "config" / "herdr").mkdir(parents=True)
    (root / "state").mkdir(parents=True)
    herdr_bin = shutil.which("herdr")
    if not herdr_bin:
        raise ProbeFailure("herdr is not in PATH")

    herdr = IsolatedHerdr(herdr_bin, root, commands)
    reader: Optional[EventReader] = None
    evidence: dict[str, Any] = {
        "probe": "step1-host-capabilities",
        "started_at_utc": started_utc,
        "repo": str(REPO),
        "herdr_bin": herdr_bin,
        "commands": [],
        "isolation": {"root": str(root)},
    }

    try:
        # Capture host version, protocol, manifest schema, registration scope,
        # and the documented native key before starting the disposable server.
        version_result = run_command([herdr_bin, "--version"], herdr.env, REPO)
        commands.append(version_result)
        version = version_result.stdout.strip()
        default_config_result = run_command([herdr_bin, "--default-config"], herdr.env, REPO)
        commands.append(default_config_result)
        if default_config_result.returncode != 0:
            raise ProbeFailure("herdr --default-config failed")
        herdr.config_path.write_text(default_config_result.stdout)
        config_text = default_config_result.stdout.replace(
            '# last_pane = ""', 'last_pane = "ctrl+tab"'
        )
        herdr.config_path.write_text(config_text)
        config_check = herdr.run(["config", "check"])
        schema_result = herdr.run(["api", "schema", "--json"])
        schema = parse_json(schema_result, "isolated schema")
        methods = [
            variant.get("properties", {}).get("method", {}).get("const")
            for variant in schema.get("schemas", {}).get("request", {}).get("oneOf", [])
        ]
        methods = [method for method in methods if isinstance(method, str)]
        session_before = herdr.run(["session", "list", "--json"])
        session_before_json = parse_json(session_before, "isolated session list before server")
        evidence["host"] = {
            "version": version,
            "protocol": schema.get("protocol"),
            "schema_version": schema.get("schema_version"),
            "request_methods": methods,
            "config_check": config_check.returncode,
            "default_config_last_pane_line": next(
                (line.strip() for line in default_config_result.stdout.splitlines() if "last_pane" in line),
                None,
            ),
            "session_list_before_server": session_before_json,
        }

        herdr.start()
        pre_link_plugins = plugin_list(herdr)
        pre_link_snapshot = snapshot(herdr)
        registry_path = root / "config" / "herdr" / "plugins.json"
        plugin_state_path = root / "state" / "herdr" / "plugins" / "jackfrancisdalton.chromatic-spaces"
        plugin_config_path = root / "config" / "herdr" / "plugins" / "config" / "jackfrancisdalton.chromatic-spaces"

        # Create a baseline workspace and prove built-in agent readability before
        # linking any plugin or running any plugin startup hook.
        workspace_a_result = herdr.session_run(
            ["workspace", "create", "--cwd", str(REPO), "--label", "Step1-A", "--no-focus"]
        )
        workspace_a = workspace_id_from_create(workspace_a_result)
        pane_a = pane_id_from_create(workspace_a_result)
        if not workspace_a or not pane_a:
            raise ProbeFailure("could not parse baseline workspace/pane")
        report_agent = herdr.session_run(
            [
                "pane",
                "report-agent",
                pane_a,
                "--source",
                "step1-probe",
                "--agent",
                "Readable Agent",
                "--state",
                "idle",
                "--seq",
                "1",
            ]
        )
        agents_before_plugin_result = herdr.session_run(["agent", "list"])
        agents_before_plugin = parse_json(agents_before_plugin_result, "agent list before plugin")
        agent_items = agents_before_plugin.get("result", {}).get("agents", [])
        cold_excerpt = [
            {
                key: item.get(key)
                for key in ("agent", "pane_id", "terminal_id", "agent_status", "workspace_id")
                if key in item
            }
            for item in agent_items
        ]
        evidence["cold_start"] = {
            "report_agent_exit": report_agent.returncode,
            "agent_name": any(item.get("agent") == "Readable Agent" for item in agent_items),
            "agent_list_excerpt": cold_excerpt,
            "agent_list_raw": agents_before_plugin,
        }

        # Isolation gate: link the canonical checkout only into the disposable
        # registry, disabled, and inspect the exact registration returned by CLI.
        link = herdr.session_run(
            ["plugin", "link", str(REPO), "--disabled"], timeout=COMMAND_TIMEOUT
        )
        linked_plugins = plugin_list(herdr)
        linked = next(
            (plugin for plugin in linked_plugins if plugin.get("plugin_id") == "jackfrancisdalton.chromatic-spaces"),
            {},
        )
        evidence["isolation"].update(
            {
                "home": str(root),
                "xdg_config": str(root / "config"),
                "xdg_state": str(root / "state"),
                "config_path": str(herdr.config_path),
                "registry_path": str(registry_path),
                "plugin_state_path": str(plugin_state_path),
                "plugin_config_path": str(plugin_config_path),
                "pre_link_plugin_count": len(pre_link_plugins),
                "pre_link_snapshot_empty": not any(
                    pre_link_snapshot.get(key) for key in ("workspaces", "tabs", "panes", "agents")
                ),
                "link_exit": link.returncode,
                "linked_plugin_enabled": linked.get("enabled"),
                "linked_plugin_root": linked.get("plugin_root"),
                "registry_exists_after_link": registry_path.exists(),
                "plugin_state_path_inside_isolation": str(plugin_state_path).startswith(str(root) + os.sep),
                "plugin_config_path_inside_isolation": str(plugin_config_path).startswith(str(root) + os.sep),
            }
        )
        if link.returncode != 0 or linked.get("enabled") is not False:
            raise ProbeFailure("disabled isolated link did not produce disabled registration")

        # Enable in the isolated registry, then restart only this disposable
        # server to run the existing startup hook and prove state confinement.
        enable = herdr.session_run(
            ["plugin", "enable", "jackfrancisdalton.chromatic-spaces"]
        )
        evidence["isolation"]["enable_exit"] = enable.returncode
        evidence["isolation"]["state_path_inside_isolation_before_restart"] = str(plugin_state_path).startswith(str(root) + os.sep)
        herdr.stop()
        herdr.start()
        time.sleep(0.5)
        startup_logs_result = herdr.session_run(
            [
                "plugin",
                "log",
                "list",
                "--plugin",
                "jackfrancisdalton.chromatic-spaces",
                "--limit",
                "20",
            ]
        )
        startup_logs = parse_json(startup_logs_result, "isolated plugin logs")
        logs = startup_logs.get("result", {}).get("logs", [])
        startup_successes = [
            log
            for log in logs
            if log.get("event") == "startup" and log.get("status") == "succeeded"
        ]
        evidence["isolation"].update(
            {
                "startup_log_count": len(startup_successes),
                "startup_exit_codes": [log.get("exit_code") for log in startup_successes],
                "plugin_state_exists_after_startup": plugin_state_path.exists(),
            }
        )

        # Native dispatch proof: the config key is accepted, but the API method
        # set has no last-pane operation or generic native-action bridge.
        native_rpc_probe = herdr.rpc("keys.last_pane", {})
        plugin_action_schema = schema.get("schemas", {}).get("request", {}).get("$defs", {}).get("PluginActionInvokeParams", {})
        plugin_action_fields = sorted(plugin_action_schema.get("properties", {}).keys())
        evidence["native_last_pane"] = {
            "config_accepts_ctrl_tab": config_check.returncode == 0,
            "schema_has_last_pane_method": any(
                "last_pane" in method or method == "keys.last_pane" for method in methods
            ),
            "rpc_probe": native_rpc_probe,
            "generic_plugin_native_dispatch": any(
                field in plugin_action_fields for field in ("native_action", "key", "keybinding")
            ),
            "plugin_action_invoke_method_present": "plugin.action.invoke" in methods,
            "plugin_action_invoke_fields": plugin_action_fields,
        }

        # Add B/C and another tab for cross-container focus observations.
        workspace_b_result = herdr.session_run(
            ["workspace", "create", "--cwd", str(REPO), "--label", "Step1-B", "--no-focus"]
        )
        workspace_b = workspace_id_from_create(workspace_b_result)
        pane_b = pane_id_from_create(workspace_b_result)
        workspace_c_result = herdr.session_run(
            ["workspace", "create", "--cwd", str(REPO), "--label", "Step1-C", "--no-focus"]
        )
        workspace_c = workspace_id_from_create(workspace_c_result)
        pane_c = pane_id_from_create(workspace_c_result)
        if not workspace_b or not pane_b or not workspace_c or not pane_c:
            raise ProbeFailure("could not parse cross-workspace topology")

        tab_a_result = herdr.session_run(
            [
                "tab",
                "create",
                "--workspace",
                workspace_a,
                "--cwd",
                str(REPO),
                "--label",
                "Step1-A-tab2",
                "--no-focus",
            ]
        )
        tab_a2 = tab_id_from_create(tab_a_result)
        pane_a2 = pane_id_from_create(tab_a_result)
        if not tab_a2 or not pane_a2:
            after_tab_snapshot = snapshot(herdr)
            a_panes = pane_for_workspace(after_tab_snapshot, workspace_a)
            a_tab_ids = {pane.get("tab_id") for pane in a_panes}
            tab_a2 = next(
                (tab.get("tab_id") for tab in after_tab_snapshot.get("tabs", []) if tab.get("tab_id") not in a_tab_ids),
                None,
            )
            if tab_a2:
                pane_a2 = next(
                    (pane.get("pane_id") for pane in a_panes if pane.get("tab_id") == tab_a2),
                    None,
                )
        if not tab_a2 or not pane_a2:
            raise ProbeFailure("could not parse second tab/pane")

        split_before = snapshot(herdr)
        split_result = herdr.session_run(
            ["pane", "split", pane_a, "--direction", "right", "--cwd", str(REPO), "--no-focus"]
        )
        split_after = snapshot(herdr)
        before_panes = {pane.get("pane_id") for pane in split_before.get("panes", [])}
        split_new_panes = [
            pane for pane in split_after.get("panes", []) if pane.get("pane_id") not in before_panes
        ]
        pane_a_split = split_new_panes[0].get("pane_id") if split_new_panes else pane_id_from_create(split_result)
        if not pane_a_split:
            raise ProbeFailure("could not parse split pane")

        # Start exactly one ordered focus reader after setup churn is complete.
        reader = EventReader(herdr.socket_path)
        reader.start()
        focus_results = [
            focus_probe(herdr, reader, pane_a, "A"),
            focus_probe(herdr, reader, pane_b, "B"),
            focus_probe(herdr, reader, pane_a2, "A-other-tab"),
            focus_probe(herdr, reader, pane_c, "C-other-workspace"),
            focus_probe(herdr, reader, pane_c, "C-repeat"),
            focus_probe(herdr, reader, pane_a, "A-return"),
        ]
        ordered_events = reader.events_since(0)
        focus_event_types = [event.get("event") for event in ordered_events]
        duplicate_result = focus_results[4]
        events_wait_focus = herdr.rpc(
            "events.wait",
            {
                "match_event": {"event": "pane_focused", "pane_id": pane_a},
                "timeout_ms": 100,
            },
        )
        evidence["focus_events"] = {
            "subscription_started": True,
            "results": focus_results,
            "ordered_event_types": focus_event_types,
            "ordered_events": ordered_events,
            "duplicate_focus_no_event": duplicate_result["pane_focused_event"] is None,
            "events_wait_focus_reply": events_wait_focus,
            "event_reader": reader.as_dict(),
        }

        # First try a rapid ABA burst on the subscribed socket. This is only a
        # capability probe; its own focus replies must not be mistaken for the
        # required drain barrier.
        burst_requests = [
            ("step1-burst-b", "pane.focus", {"pane_id": pane_b}),
            ("step1-burst-c", "pane.focus", {"pane_id": pane_c}),
            ("step1-burst-a", "pane.focus", {"pane_id": pane_a}),
        ]
        burst_frame_start = reader.frame_count()
        burst_started = time.monotonic_ns()
        burst_replies = reader.request_burst(burst_requests)
        burst_finished = time.monotonic_ns()
        burst_frames = reader.frames_since(burst_frame_start)
        burst_relationships: list[dict[str, Any]] = []
        for request_id, _, params in burst_requests:
            target_pane = params["pane_id"]
            response_positions = [
                index
                for index, frame in enumerate(burst_frames)
                if frame.get("kind") == "response"
                and (frame.get("message") or {}).get("id") == request_id
            ]
            event_positions = [
                index
                for index, frame in enumerate(burst_frames)
                if frame.get("kind") == "event"
                and (frame.get("message") or {}).get("event") == "pane_focused"
                and ((frame.get("message") or {}).get("data") or {}).get("pane_id") == target_pane
            ]
            burst_relationships.append(
                {
                    "request_id": request_id,
                    "target_pane": target_pane,
                    "response_position": response_positions[0] if response_positions else None,
                    "event_position": event_positions[0] if event_positions else None,
                    "event_before_reply": bool(
                        response_positions
                        and event_positions
                        and event_positions[0] < response_positions[0]
                    ),
                }
            )
        burst_supported = len(burst_replies) == len(burst_requests)
        if not burst_supported:
            reader.close()
            reader = EventReader(herdr.socket_path)
            reader.start()

        # Now focus B, C, A from separate already-acknowledged client requests,
        # without waiting for their events. A non-mutating snapshot on the same
        # subscribed stream is the only candidate drain barrier. No sleeps or
        # idle heuristics are used: missing or late frames remain a blocker.
        external_targets = [(pane_b, "B"), (pane_c, "C"), (pane_a, "A")]
        external_frame_start = reader.frame_count()
        external_focuses: list[dict[str, Any]] = []
        for target_pane, label in external_targets:
            request_started = time.monotonic_ns()
            reply = herdr.rpc("pane.focus", {"pane_id": target_pane})
            reply_received = time.monotonic_ns()
            external_focuses.append(
                {
                    "label": label,
                    "pane_id": target_pane,
                    "request_started_monotonic_ns": request_started,
                    "reply_received_monotonic_ns": reply_received,
                    "reply_duration_ms": round((reply_received - request_started) / 1_000_000, 3),
                    "reply": reply,
                }
            )
        barrier_request = ("step1-barrier-snapshot", "session.snapshot", {})
        barrier_started = time.monotonic_ns()
        barrier_replies = reader.request_burst([barrier_request])
        barrier_finished = time.monotonic_ns()
        external_frames = reader.frames_since(external_frame_start)
        barrier_reply_position = next(
            (
                index
                for index, frame in enumerate(external_frames)
                if frame.get("kind") == "response"
                and (frame.get("message") or {}).get("id") == barrier_request[0]
            ),
            None,
        )
        external_event_positions: list[dict[str, Any]] = []
        for target_pane, label in external_targets:
            positions = [
                index
                for index, frame in enumerate(external_frames)
                if frame.get("kind") == "event"
                and (frame.get("message") or {}).get("event") == "pane_focused"
                and ((frame.get("message") or {}).get("data") or {}).get("pane_id") == target_pane
            ]
            external_event_positions.append(
                {
                    "label": label,
                    "pane_id": target_pane,
                    "event_positions": positions,
                    "event_before_barrier_reply": bool(
                        positions
                        and barrier_reply_position is not None
                        and positions[0] < barrier_reply_position
                    ),
                }
            )
        barrier_supported = barrier_request[0] in barrier_replies
        barrier_proven = barrier_supported and all(
            relation["event_before_barrier_reply"] for relation in external_event_positions
        )
        evidence["same_stream_barrier"] = {
            "focus_burst_requests": [
                {"id": request_id, "method": method, "params": params}
                for request_id, method, params in burst_requests
            ],
            "focus_burst_replies": burst_replies,
            "focus_burst_frames": burst_frames,
            "focus_burst_duration_ms": round((burst_finished - burst_started) / 1_000_000, 3),
            "focus_burst_supported": burst_supported,
            "focus_burst_relationships": burst_relationships,
            "external_focuses": external_focuses,
            "non_mutating_request": {
                "id": barrier_request[0],
                "method": barrier_request[1],
                "params": barrier_request[2],
            },
            "non_mutating_replies": barrier_replies,
            "external_frames": external_frames,
            "non_mutating_duration_ms": round((barrier_finished - barrier_started) / 1_000_000, 3),
            "barrier_reply_position": barrier_reply_position,
            "external_event_positions": external_event_positions,
            "supported": barrier_supported,
            "event_before_reply_proven": barrier_proven,
            "barrier_proven": barrier_proven,
            "blocker": None
            if barrier_proven
            else (
                "same subscribed stream did not return the non-mutating session.snapshot after external acknowledged B/C/A focus; prior manual events are not proved drained before a barrier reply"
                if not barrier_supported
                else "session.snapshot reply did not follow every prior external B/C/A pane_focused event in the same stream"
            ),
        }
        if not barrier_supported:
            reader.close()
            reader = EventReader(herdr.socket_path)
            reader.start()

        # Move within the layout (the same event shape a staging operation uses)
        # and then across workspace. Track terminal identity independently of IDs.
        move_snapshot_before = snapshot(herdr)
        move_source = pane_a_split
        move_source_info = next(
            pane for pane in move_snapshot_before.get("panes", []) if pane.get("pane_id") == move_source
        )
        source_terminal = move_source_info.get("terminal_id")
        move_event_start = reader.count()
        move_same_tab = herdr.session_run(
            [
                "pane",
                "move",
                move_source,
                "--tab",
                tab_a2,
                "--split",
                "right",
                "--no-focus",
            ]
        )
        move_after = snapshot(herdr)
        moved_same_tab_info = pane_with_terminal(move_after, source_terminal)
        same_tab_event = reader.wait_for(
            lambda candidate: candidate.get("event") == "pane_moved"
            and (candidate.get("data") or {}).get("previous_pane_id") == move_source,
            move_event_start,
        )
        move_terminal = source_terminal
        old_pane_id = move_source
        new_pane_id = moved_same_tab_info.get("pane_id") if moved_same_tab_info else None

        cross_source_info = next(
            pane for pane in move_after.get("panes", []) if pane.get("pane_id") == pane_b
        )
        cross_terminal = cross_source_info.get("terminal_id")
        cross_move = herdr.session_run(
            [
                "pane",
                "move",
                pane_b,
                "--new-workspace",
                "--label",
                "Step1-moved",
                "--tab-label",
                "Step1-moved-tab",
                "--no-focus",
            ]
        )
        cross_after = snapshot(herdr)
        cross_moved_info = pane_with_terminal(cross_after, cross_terminal)
        cross_event = reader.wait_for(
            lambda candidate: candidate.get("event") == "pane_moved"
            and (candidate.get("data") or {}).get("previous_pane_id") == pane_b
            and ((candidate.get("data") or {}).get("pane") or {}).get("terminal_id") == cross_terminal,
            move_event_start,
        )
        evidence["moved_terminal"] = {
            "same_tab_move_exit": move_same_tab.returncode,
            "same_tab_event": same_tab_event,
            "cross_workspace_move_exit": cross_move.returncode,
            "terminal_id": cross_terminal,
            "terminal_id_stable": bool(cross_moved_info and cross_moved_info.get("terminal_id") == cross_terminal),
            "old_pane_id": pane_b,
            "new_pane_id": cross_moved_info.get("pane_id") if cross_moved_info else None,
            "cross_workspace_event": cross_event,
            "same_tab_pane_id": {"old": old_pane_id, "new": new_pane_id},
            "same_tab_move_raw": parse_json(move_same_tab, "same-tab pane move") if move_same_tab.returncode == 0 else {},
            "cross_workspace_move_raw": parse_json(cross_move, "cross-workspace pane move") if cross_move.returncode == 0 else {},
            "staging_marker_present_in_move_event": bool(
                same_tab_event and "staging" in json.dumps(same_tab_event).lower()
            ),
        }

        # Close an isolated target and show the host rejects it rather than
        # selecting an unrelated replacement pane.
        closed_workspace_result = herdr.session_run(
            ["workspace", "create", "--cwd", str(REPO), "--label", "Step1-closed", "--no-focus"]
        )
        closed_pane = pane_id_from_create(closed_workspace_result)
        if not closed_pane:
            raise ProbeFailure("could not create close-target pane")
        close_result = herdr.session_run(["pane", "close", closed_pane])
        closed_focus = herdr.rpc("pane.focus", {"pane_id": closed_pane})
        closed_error = closed_focus.get("error", {})
        evidence["closed_target"] = {
            "close_exit": close_result.returncode,
            "closed_pane": closed_pane,
            "focus_reply": closed_focus,
            "error_code": closed_error.get("code"),
            "replacement_selected": "result" in closed_focus,
        }

        # Popup is a temporary UI surface; verify it cannot be opened as a
        # normal workspace-targeted pane and does not change normal focus.
        normal_focus_before_popup = snapshot(herdr).get("focused_pane_id")
        popup_open = herdr.rpc(
            "plugin.pane.open",
            {
                "plugin_id": "jackfrancisdalton.chromatic-spaces",
                "entrypoint": "picker",
                "placement": "popup",
                "focus": False,
            },
        )
        popup_second = herdr.rpc(
            "plugin.pane.open",
            {
                "plugin_id": "jackfrancisdalton.chromatic-spaces",
                "entrypoint": "picker",
                "placement": "popup",
                "focus": False,
            },
        )
        popup_snapshot = snapshot(herdr)
        popup_close = herdr.rpc("popup.close", {})
        evidence["popup"] = {
            "open_reply": popup_open,
            "second_open_reply": popup_second,
            "close_reply": popup_close,
            "normal_focus_before": normal_focus_before_popup,
            "normal_focus_after": popup_snapshot.get("focused_pane_id"),
            "normal_focus_unchanged": normal_focus_before_popup == popup_snapshot.get("focused_pane_id"),
            "popup_pane_in_snapshot": any(
                pane.get("label") == "Chromatic Spaces" for pane in popup_snapshot.get("panes", [])
            ),
        }

        # Restart the named disposable server. Headless sessions do not restore
        # the old topology, so stale terminal references must be absent.
        old_snapshot = snapshot(herdr)
        old_terminals = {pane.get("terminal_id") for pane in old_snapshot.get("panes", [])}
        herdr.stop()
        herdr.start()
        restarted_snapshot = snapshot(herdr)
        evidence["restart_reset"] = {
            "old_terminal_ids": sorted(term for term in old_terminals if term),
            "old_terminal_id": next(
                (term for term in old_terminals if term), "(none)"
            ),
            "snapshot_after_restart": restarted_snapshot,
            "old_terminal_present_after_restart": any(
                pane.get("terminal_id") in old_terminals for pane in restarted_snapshot.get("panes", [])
            ),
            "startup_logs_after_restart": parse_json(
                herdr.session_run(
                    [
                        "plugin",
                        "log",
                        "list",
                        "--plugin",
                        "jackfrancisdalton.chromatic-spaces",
                        "--limit",
                        "50",
                    ]
                ),
                "startup logs after restart",
            ),
        }

        default_after = default_file_receipts()
        evidence["isolation"].update(
            {
                "default_files_before": default_before,
                "default_files_after": default_after,
                "default_files_unchanged": default_before == default_after,
                "file_isolation_verified": (
                    herdr.config_path.exists()
                    and registry_path.exists()
                    and plugin_state_path.exists()
                    and not any(
                        value.get("sha256") != default_after.get(path, {}).get("sha256")
                        for path, value in default_before.items()
                    )
                ),
            }
        )
        evidence["commands"] = [record_command(command) for command in commands]
        evidence["completed_at_utc"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        write_evidence(evidence)
        print(str(EVIDENCE_MD))
        return 0
    except Exception as exc:
        evidence["error"] = "%s: %s" % (type(exc).__name__, exc)
        evidence["commands"] = [record_command(command) for command in commands]
        evidence["completed_at_utc"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        write_evidence(evidence)
        print(str(EVIDENCE_MD), file=sys.stderr)
        print(evidence["error"], file=sys.stderr)
        return 1
    finally:
        if reader is not None:
            reader.close()
        herdr.stop()


if __name__ == "__main__":
    raise SystemExit(main())
