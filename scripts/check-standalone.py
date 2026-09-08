#!/usr/bin/env python3
"""Run against a disposable HOME/config/registry/socket; never use live Herdr.

No installed title publisher, scheduler, agent integration, or model credential
is inherited. Fixture panes are ordinary shells declared through report_agent.
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
if not HERDR:
    raise SystemExit("Herdr is required; set HERDR_BIN_PATH")
HOME = Path(tempfile.mkdtemp(prefix="mosaic-proof-", dir="/tmp"))
CONFIG = HOME / ".config" / "herdr"
STATE = HOME / ".local" / "state" / "herdr" / "plugins" / "iurysza.mosaic"
SOCKET = CONFIG / "herdr.sock"
ENV = {
    "HOME": str(HOME), "XDG_CONFIG_HOME": str(HOME / ".config"),
    "XDG_STATE_HOME": str(HOME / ".local" / "state"),
    "XDG_DATA_HOME": str(HOME / ".local" / "share"),
    "XDG_CACHE_HOME": str(HOME / ".cache"),
    "HERDR_CONFIG_PATH": str(CONFIG / "config.toml"),
    "HERDR_SOCKET_PATH": str(SOCKET), "HERDR_BIN_PATH": HERDR,
    "HERDR_PLUGIN_ROOT": str(ROOT), "HERDR_PLUGIN_ID": "iurysza.mosaic",
    "HERDR_PLUGIN_STATE_DIR": str(STATE),
    "HERDR_PLUGIN_CONFIG_DIR": str(CONFIG / "plugins" / "config" / "iurysza.mosaic"),
    "PATH": "/usr/bin:/bin", "SHELL": "/bin/sh", "TERM": "xterm-256color",
    "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TMPDIR": str(HOME),
}
# Set before importing plugin modules so no path can fall back to the user's HOME.
os.environ.clear()
os.environ.update(ENV)
sys.path.insert(0, str(ROOT / "src"))
import ctx
import elapsed
import refresh
import rpc
import state

# The existing elapsed TTL is the observable deadline: one 30-second round plus
# its 15-second margin. Polling uses the existing isolated rehearsal's 50 ms step.
DEADLINE = elapsed.TTL_MS / 1000.0
POLL = 0.05
server = None
receipts = {}
worker_pids = set()


def wait(label, read):
    end = time.monotonic() + DEADLINE
    last_error = None
    while time.monotonic() < end:
        try:
            value = read()
            if value:
                return value
        except (rpc.RpcError, OSError, KeyError) as error:
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
        server.terminate()  # Only the disposable process created above.
        server.wait(timeout=DEADLINE)
    server = None


def logs():
    return rpc.call("plugin.log.list", {"plugin_id": ctx.PLUGIN_ID}).get("logs", [])


def action(name):
    before = {log["log_id"] for log in logs()}
    rpc.call("plugin.action.invoke", {"plugin_id": ctx.PLUGIN_ID, "action_id": name})

    def result():
        for log in logs():
            if log["log_id"] not in before and log.get("action_id") in (name, ctx.PLUGIN_ID + "." + name):
                if log["status"] == "failed":
                    raise AssertionError(json.dumps(log, indent=2))
                if log["status"] == "succeeded":
                    return log
        return None
    return wait("action " + name, result)


def current_agent(pane_id):
    return next((agent for agent in rpc.agents() if agent["pane_id"] == pane_id), {})


def titles(pane_id):
    return {key: value for key, value in current_agent(pane_id).get("tokens", {}).items()
            if key.startswith("title_") and value}


def heartbeat():
    value = refresh.status()
    if value:
        worker_pids.add(value["pid"])
    return value


def running(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


try:
    CONFIG.mkdir(parents=True)
    (CONFIG / "config.toml").write_text('[theme]\nname = "gruvbox"\n', encoding="utf-8")
    original_config = (CONFIG / "config.toml").read_bytes()
    subprocess.check_call([HERDR, "plugin", "link", str(ROOT), "--disabled"], env=ENV,
                          stdout=subprocess.DEVNULL)
    start_server()
    created = rpc.call("workspace.create", {"label": "Standalone fixture", "cwd": str(HOME)})
    pane_id = created["root_pane"]["pane_id"]
    tab_id = created["tab"]["tab_id"]
    workspace_id = created["workspace"]["workspace_id"]
    rpc.call("tab.rename", {"tab_id": tab_id, "label": "Standalone title"})
    rpc.call("plugin.enable", {"plugin_id": ctx.PLUGIN_ID})
    report = {"pane_id": pane_id, "source": "mosaic-proof", "agent": "pi", "state": "working"}
    rpc.call("pane.report_agent", report)
    receipts["install"] = action("install")
    wait("durable coloured title", lambda: "Standalone title" in titles(pane_id).values())
    first = wait("refresh worker", heartbeat)
    receipts["first_round"] = first
    assert len(titles(pane_id)) == 1, titles(pane_id)
    assert not current_agent(pane_id).get("tokens", {}).get("elapsed"), "invented initial completion"
    # Agent-provided tier metadata remains outside the plugin's ownership.
    rpc.call("pane.report_metadata", {"pane_id": pane_id, "source": "themed-proof",
                                      "tokens": {"themed_model_tier": "fixture-tier"}})
    wait("working observation", lambda: state.load()["agent_settled"].get(pane_id, {}).get("status") == "working")
    report["state"] = "idle"
    rpc.call("pane.report_agent", report)
    wait("completion event", lambda: state.load()["agent_settled"].get(pane_id, {}).get("last_settled_at"))
    wait("completion clock", lambda: current_agent(pane_id).get("tokens", {}).get("elapsed") == "now")
    with ctx.Lock():
        st = state.load()
        # Controlled fixture near the next displayed-minute boundary, not a
        # production timeout. One normal 30-second timer round must advance it.
        st["agent_settled"][pane_id]["last_settled_at"] = int(time.time()) - 65
        state.save(st)
    subprocess.check_call(["/usr/bin/python3", str(ROOT / "src" / "main.py"), "elapsed-publish"], env=ENV)
    before_clock = current_agent(pane_id)["tokens"]["elapsed"]
    wait("timer advances elapsed without an event", lambda: current_agent(pane_id).get("tokens", {}).get("elapsed") not in (None, before_clock))
    receipts["timer"] = {"before": before_clock, "after": current_agent(pane_id)["tokens"]["elapsed"],
                         "round": heartbeat()}
    assert current_agent(pane_id)["tokens"]["themed_model_tier"] == "fixture-tier"
    rpc.call("tab.rename", {"tab_id": tab_id, "label": "Renamed title"})
    wait("tab rename hook", lambda: "Renamed title" in titles(pane_id).values())
    identities = state.load()["identities"]
    old_generation = refresh.generation()
    old_pid = heartbeat()["pid"]
    stop_server()
    start_server()
    new_generation = refresh.generation()
    receipts["socket_generations"] = {"before": old_generation, "after": new_generation}
    assert new_generation != old_generation, receipts["socket_generations"]
    new = wait("restart refresh worker", heartbeat)
    assert new["pid"] != old_pid
    assert state.load()["identities"] == identities
    receipts["restart"] = new
    snapshot = rpc.call("session.snapshot", {})["snapshot"]
    # Restored shells are not agents until an integration reports them again.
    pane = next(pane for pane in snapshot["panes"] if pane["workspace_id"] == workspace_id)
    pane_id = pane["pane_id"]
    report.update({"pane_id": pane_id, "state": "working"})
    rpc.call("pane.report_agent", report)
    wait("title after restart", lambda: "Renamed title" in titles(pane_id).values())
    wait("previous generation exits", lambda: not running(old_pid))
    rpc.call("pane.report_metadata", {"pane_id": pane_id, "source": "themed-proof",
                                      "tokens": {"themed_model_tier": "fixture-tier"}})
    report["state"] = "idle"
    rpc.call("pane.report_agent", report)
    wait("completion after restart", lambda: current_agent(pane_id).get("tokens", {}).get("elapsed"))
    disabled_pid = heartbeat()["pid"]
    rpc.call("plugin.disable", {"plugin_id": ctx.PLUGIN_ID})
    wait("disabled worker exits", lambda: not running(disabled_pid))
    wait("stale elapsed expires", lambda: not current_agent(pane_id).get("tokens", {}).get("elapsed"))
    assert "Renamed title" in titles(pane_id).values(), "refresh failure erased the title"
    assert current_agent(pane_id)["tokens"]["themed_model_tier"] == "fixture-tier"
    receipts["disabled"] = {"worker_exited": True, "elapsed_expired": True, "title_retained": True}
    rpc.call("plugin.enable", {"plugin_id": ctx.PLUGIN_ID})
    action("install")
    wait("worker after re-enable", lambda: heartbeat() and heartbeat()["pid"] != disabled_pid)
    before_pid = heartbeat()["pid"]
    subprocess.check_call(["/usr/bin/python3", str(ROOT / "src" / "main.py"), "reconcile"], env=ENV,
                          stdout=subprocess.DEVNULL)
    assert heartbeat()["pid"] == before_pid, "duplicate worker on reconcile"
    receipts["uninstall"] = action("uninstall")
    assert (CONFIG / "config.toml").read_bytes() == original_config
    assert not titles(pane_id), titles(pane_id)
    assert not current_agent(pane_id).get("tokens", {}).get("elapsed")
    assert current_agent(pane_id)["tokens"]["themed_model_tier"] == "fixture-tier"
    wait("worker exits after uninstall", lambda: not running(before_pid))
    receipts["result"] = "passed"
finally:
    stop_server()
    (HOME / "receipt.json").write_text(json.dumps(receipts, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipts, indent=2), flush=True)
    print("Standalone evidence: %s" % (HOME / "receipt.json"), flush=True)
