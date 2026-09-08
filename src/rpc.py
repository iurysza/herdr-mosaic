"""Newline-delimited JSON client for the Herdr socket API (protocol 19).

`herdr api` exposes only `snapshot` and `schema`, so the calls this plugin needs
(`workspace.report_metadata`, `pane.report_metadata`, `agent.view.set`,
`client.window_title.set`, `server.reload_config`) are issued over the socket
directly. Envelope: {"id", "method", "params"} -> {"id", "result"|"error"}.
"""

import json
import socket
import uuid

import ctx


class RpcError(Exception):
    def __init__(self, code, message):
        Exception.__init__(self, "%s: %s" % (code, message))
        self.code = code
        self.message = message


def call(method, params=None, timeout=10.0, sock_path=None):
    path = sock_path or ctx.socket_path()
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(path)
    except OSError as exc:
        sock.close()
        raise RpcError("socket_unavailable", "%s (%s)" % (path, exc))
    rid = "%s-%s" % (ctx.PLUGIN_ID, uuid.uuid4().hex[:10])
    try:
        sock.sendall((json.dumps({"id": rid, "method": method,
                                  "params": params or {}}) + "\n").encode("utf-8"))
        stream = sock.makefile("rb")
        for raw in stream:
            if not raw.strip():
                continue
            try:
                msg = json.loads(raw.decode("utf-8"))
            except ValueError:
                continue
            # the server may interleave unsolicited events; match on id
            if msg.get("id") != rid:
                continue
            if "error" in msg:
                err = msg["error"] or {}
                raise RpcError(err.get("code", "unknown"), err.get("message", ""))
            return msg.get("result") or {}
        raise RpcError("no_response", "socket closed before a reply for %s" % method)
    finally:
        sock.close()


def try_call(method, params=None, **kw):
    """Call, returning (result, None) or (None, RpcError)."""
    try:
        return call(method, params, **kw), None
    except RpcError as exc:
        return None, exc


# -- convenience reads -----------------------------------------------------

def ping():
    return call("ping", {})


def workspaces():
    return call("workspace.list", {}).get("workspaces", []) or []


def agents():
    return call("agent.list", {}).get("agents", []) or []


def panes(workspace_id=None):
    params = {}
    if workspace_id:
        params["workspace_id"] = workspace_id
    return call("pane.list", params).get("panes", []) or []


def focused_workspace():
    for w in workspaces():
        if w.get("focused"):
            return w
    return None
