#!/usr/bin/env python3
"""Prove elapsed 3-cell values on a disposable Herdr, never the live session.

Stored token length is publication width. Screen columns are a separate
termctrl check and are not inferred from metadata.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HERDR = os.environ.get("HERDR_BIN_PATH") or shutil.which("herdr")
TERMCTRL = os.environ.get("TERMCTRL_BIN") or shutil.which("termctrl")
if not HERDR:
    raise SystemExit("Herdr is required; set HERDR_BIN_PATH")
HOME = Path(tempfile.mkdtemp(prefix="mosaic-elapsed-col-", dir="/tmp"))
CONFIG = HOME / ".config" / "herdr"
SOCKET = CONFIG / "herdr.sock"
TERMCTRL_DIR = Path(tempfile.mkdtemp(prefix="tec-", dir="/tmp"))
SESSION = "mec%s" % os.getpid()
ENV = {
    "HOME": str(HOME), "XDG_CONFIG_HOME": str(HOME / ".config"),
    "XDG_STATE_HOME": str(HOME / ".local" / "state"),
    "XDG_DATA_HOME": str(HOME / ".local" / "share"),
    "XDG_CACHE_HOME": str(HOME / ".cache"),
    "HERDR_CONFIG_PATH": str(CONFIG / "config.toml"),
    "HERDR_SOCKET_PATH": str(SOCKET), "HERDR_BIN_PATH": HERDR,
    "PATH": "/usr/bin:/bin", "SHELL": "/bin/sh", "TERM": "xterm-256color",
    "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TMPDIR": str(HOME),
    "TERMCTRL_RUNTIME_DIR": str(TERMCTRL_DIR),
}
os.environ.clear()
os.environ.update(ENV)
sys.path.insert(0, str(ROOT / "src"))
import elapsed
import rpc

DEADLINE = elapsed.TTL_MS / 1000.0
POLL = 0.05
server = None
termctrl_started = False
receipts = {"home": str(HOME), "session": SESSION, "ingest": [],
            "mosaic_values": [], "render": {"attempted": False}}


def wait(label, read):
    end = time.monotonic() + DEADLINE
    last_error = None
    while time.monotonic() < end:
        try:
            value = read()
            if value:
                return value
        except (rpc.RpcError, OSError, KeyError, RuntimeError) as error:
            last_error = error
        time.sleep(POLL)
    raise AssertionError("%s did not complete within elapsed TTL %ss: %s; evidence %s"
                         % (label, DEADLINE, last_error, HOME))


def start_server():
    global server
    with (HOME / "server.log").open("a") as log:
        server = subprocess.Popen([HERDR, "server"], env=ENV, cwd=str(HOME),
                                  stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                  start_new_session=True)
    wait("API ready", lambda: rpc.call("ping", {}))


def stop_server():
    global server
    if server is None:
        return
    try:
        rpc.call("server.stop", {})
    except rpc.RpcError:
        pass
    try:
        server.wait(timeout=DEADLINE)
    except subprocess.TimeoutExpired:
        server.terminate()
        server.wait(timeout=DEADLINE)
    server = None


def elapsed_of(pane_id):
    for agent in rpc.agents():
        if agent.get("pane_id") == pane_id:
            if "elapsed" not in (agent.get("tokens") or {}):
                return "__ABSENT__"
            return agent["tokens"].get("elapsed")
    return "__ABSENT__"


def report_elapsed(pane_id, value):
    rpc.call("pane.report_metadata", {
        "pane_id": pane_id, "source": elapsed.SOURCE,
        "tokens": {"elapsed": value}, "ttl_ms": elapsed.TTL_MS,
    })
    time.sleep(POLL)


def termctrl(args, timeout=DEADLINE):
    proc = subprocess.Popen(
        [TERMCTRL] + list(args), env=ENV, cwd=str(HOME),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, err = proc.communicate()
        raise AssertionError("termctrl %s exceeded elapsed TTL %ss: %s %s"
                             % (args, DEADLINE, out, err))
    return proc.returncode, (out or b"").decode("utf-8", "replace"), (err or b"").decode("utf-8", "replace")


def stop_termctrl():
    global termctrl_started
    if not termctrl_started or not TERMCTRL:
        return
    try:
        termctrl(["stop", SESSION])
    except Exception:
        pass
    termctrl_started = False


def title_columns(screen, names):
    found = {}
    lines = {}
    for line in screen.splitlines():
        for name in names:
            if name in found:
                continue
            idx = line.find(name)
            if idx >= 0:
                found[name] = idx
                lines[name] = line.rstrip()
    return found, lines


try:
    CONFIG.mkdir(parents=True)
    (CONFIG / "config.toml").write_text("\n".join([
        "[theme]",
        'name = "gruvbox"',
        "[ui]",
        "sidebar_width = 32",
        "[ui.sidebar.agents]",
        'rows = [["state_icon", { token = "$elapsed", dim = true }, "$probe_title"]]',
        "",
    ]), encoding="utf-8")
    check = subprocess.Popen(
        [HERDR, "config", "check"], env=ENV,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    check_out, _ = check.communicate(timeout=DEADLINE)
    receipts["config_check"] = {
        "rc": check.returncode,
        "output": (check_out or b"").decode("utf-8", "replace").strip(),
    }
    if check.returncode != 0:
        raise AssertionError("herdr config check failed: %s" % receipts["config_check"])
    receipts["herdr"] = subprocess.check_output(
        [HERDR, "--version"], env=ENV).decode("utf-8").strip()
    start_server()
    created = rpc.call("workspace.create", {"label": "Elapsed ingest", "cwd": str(HOME)})
    pane_id = created["root_pane"]["pane_id"]
    rpc.call("pane.report_agent", {
        "pane_id": pane_id, "source": "elapsed-probe", "agent": "pi", "state": "idle",
    })

    cases = [
        ("ascii_spaces", "   "),
        ("ascii_padded_2m", "2m "),
        ("empty", ""),
        ("null_clear", None),
        ("nbsp_three", "\u00a0" * 3),
        ("now", "now"),
        ("braille_three", elapsed.BLANK),
        ("two_m_braille", elapsed.fit_width("2m")),
        ("ninetynine_d", "99d"),
    ]
    for name, value in cases:
        report_elapsed(pane_id, value)
        got = elapsed_of(pane_id)
        receipts["ingest"].append({
            "name": name, "sent": repr(value), "got": repr(got),
            "absent": got == "__ABSENT__",
        })
        report_elapsed(pane_id, None)

    by_name = {item["name"]: item for item in receipts["ingest"]}
    assert by_name["ascii_spaces"]["absent"], by_name["ascii_spaces"]
    assert by_name["ascii_padded_2m"]["got"] == repr("2m"), by_name["ascii_padded_2m"]
    assert by_name["braille_three"]["got"] == repr(elapsed.BLANK), by_name["braille_three"]
    assert by_name["two_m_braille"]["got"] == repr(elapsed.fit_width("2m")), by_name["two_m_braille"]

    mosaic = [
        ("blank", elapsed.BLANK),
        ("two_m", elapsed.fit_width("2m")),
        ("now", elapsed.format_elapsed(0)),
        ("ten_m", elapsed.format_elapsed(10 * 60)),
        ("ninetynine_d", elapsed.format_elapsed(99 * 86400)),
        ("saturated", elapsed.format_elapsed(400 * 86400)),
    ]
    for name, value in mosaic:
        assert len(value) == elapsed.WIDTH, (name, value)
        report_elapsed(pane_id, value)
        got = elapsed_of(pane_id)
        receipts["mosaic_values"].append({
            "name": name, "sent": repr(value), "got": repr(got),
            "cells": len(value), "accepted": got == value,
        })
        assert got == value, (name, value, got)
        report_elapsed(pane_id, None)

    rows = [
        ("M-BLANK", elapsed.BLANK),
        ("M-2M", elapsed.fit_width("2m")),
        ("M-NOW", "now"),
        ("M-10M", "10m"),
        ("M-99D", "99d"),
    ]
    render_panes = []
    for name, value in rows:
        # Probe names occur only in the agent row, never workspace/tab headers.
        item = rpc.call("workspace.create", {"label": "Fixture", "cwd": str(HOME)})
        pid = item["root_pane"]["pane_id"]
        rpc.call("pane.report_agent", {
            "pane_id": pid, "source": "elapsed-probe", "agent": "pi", "state": "idle",
        })
        rpc.call("pane.report_metadata", {
            "pane_id": pid, "source": "elapsed-probe",
            "tokens": {"probe_title": name},
        })
        report_elapsed(pid, value)
        assert elapsed_of(pid) == value, (name, elapsed_of(pid))
        render_panes.append((name, pid, value))
    names = [name for name, _pid, _value in render_panes]
    receipts["published_rows"] = [
        {"name": name, "elapsed": repr(value), "cells": len(value)}
        for name, _pid, value in render_panes
    ]

    if not TERMCTRL:
        receipts["render"]["status"] = "termctrl_unavailable"
        receipts["result"] = "passed_metadata"
    else:
        receipts["render"]["attempted"] = True
        try:
            rc, out, err = termctrl([
                "start", SESSION, "--cols", "100", "--rows", "32",
                "--cwd", str(HOME), "--", HERDR,
            ])
        except AssertionError as error:
            receipts["render"]["status"] = "unverified"
            receipts["render"]["start_error"] = str(error)
            receipts["result"] = "passed_metadata_render_unverified"
            print(json.dumps(receipts, indent=2), flush=True)
            print("Elapsed-column evidence: %s" % HOME, flush=True)
            raise SystemExit(0)
        receipts["render"]["start"] = {"rc": rc, "stdout": out, "stderr": err}
        if rc != 0:
            receipts["render"]["status"] = "unverified"
            receipts["result"] = "passed_metadata_render_unverified"
        else:
            termctrl_started = True
            wait_rc, wait_out, wait_err = termctrl(
                ["wait", SESSION, "M-NOW", "--timeout", str(int(DEADLINE * 1000))])
            receipts["render"]["wait"] = {
                "rc": wait_rc, "stdout": wait_out, "stderr": wait_err,
            }
            show_rc, screen, show_err = termctrl(["show", SESSION])
            receipts["render"]["show_rc"] = show_rc
            receipts["render"]["screen"] = screen
            receipts["render"]["show_err"] = show_err
            columns, lines = title_columns(screen, names)
            receipts["render"]["title_columns"] = columns
            receipts["render"]["title_lines"] = lines
            assert show_rc == 0, show_err
            assert set(columns) == set(names), (columns, screen)
            unique = set(columns.values())
            receipts["render"]["aligned"] = len(unique) == 1
            receipts["render"]["status"] = "measured"
            assert len(unique) == 1, (columns, lines)
            name, pid, _ = render_panes[0]
            baseline = columns[name]
            transitions = []

            def clock_column(value):
                rc, screen, error = termctrl(["show", SESSION])
                assert rc == 0, error
                cols, visible = title_columns(screen, [name])
                line = visible.get(name, "")
                if value is None:
                    matches = name in cols and " · " not in line
                else:
                    matches = value + " · " + name in line
                return {"column": cols[name]} if matches else None

            for _, value in mosaic:
                report_elapsed(pid, value)
                measured = wait("rendered clock " + repr(value),
                                lambda: clock_column(value))
                assert measured["column"] == baseline, measured
                transitions.append({"elapsed": repr(value), **measured})
            receipts["render"]["transitions"] = transitions
            report_elapsed(pid, None)
            cleared = wait("cleared elapsed column", lambda: clock_column(None))
            assert cleared["column"] == baseline - elapsed.WIDTH - len(" · "), cleared
            receipts["render"]["clear_column"] = cleared["column"]
            receipts["result"] = "passed"

    print(json.dumps(receipts, indent=2), flush=True)
    print("Elapsed-column evidence: %s" % HOME, flush=True)
finally:
    stop_termctrl()
    stop_server()
    path = HOME / "elapsed-column.json"
    path.write_text(json.dumps(receipts, indent=2) + "\n", encoding="utf-8")
