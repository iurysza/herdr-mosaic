"""One detached refresh worker per Herdr socket generation.

Herdr startup hooks are one-shot, not supervised services. Install and startup
launch this worker; later relevant events restart it if it dies. It stops when
its socket is replaced, Mosaic is disabled/unlinked, or sidebar ownership ends.
No launchd, systemd, shell loop, PID killing, or external scheduler is needed.
"""

import hashlib
import json
import os
import subprocess
import time

import ctx
import rpc
import sidebar
import state

# Existing measured contract: 20-pane rounds took 940 ms maximum, 2026-09-04.
# Keep its 30-second refresh and 45-second elapsed expiry; see elapsed.py.
INTERVAL_SECONDS = 30


def generation():
    path = os.path.realpath(ctx.socket_path())
    info = os.stat(path)
    # Linux can reuse an unlinked socket's inode immediately after restart.
    return "%s:%s:%s:%s" % (path, info.st_dev, info.st_ino, info.st_ctime_ns)


def paths(key):
    name = "refresh-" + hashlib.sha256(key.encode("utf-8")).hexdigest()
    return name + ".lock", os.path.join(ctx.state_dir(), name + ".json")


def registered():
    plugins = rpc.call("plugin.list", {"plugin_id": ctx.PLUGIN_ID}).get("plugins", [])
    return any(plugin.get("plugin_id") == ctx.PLUGIN_ID and plugin.get("enabled")
               and os.path.realpath(plugin.get("plugin_root") or "") == os.path.realpath(ctx.plugin_root())
               for plugin in plugins)


def start():
    """Launch if needed. The worker takes the singleton lock before doing work."""
    with ctx.Lock():
        if not state.load().get("sidebar_installed"):
            return
        if not registered():
            raise RuntimeError("enable Mosaic from this checkout before starting sidebar refresh")
        key = generation()
        lock_name, _ = paths(key)
        try:
            # Zero means a nonblocking ownership check, not a timed operation.
            with ctx.Lock(lock_name, timeout=0):
                pass
        except RuntimeError:
            return
        env = dict(os.environ)
        env.update({
            "HERDR_PLUGIN_ID": ctx.PLUGIN_ID,
            "HERDR_PLUGIN_ROOT": ctx.plugin_root(),
            "HERDR_PLUGIN_CONFIG_DIR": ctx.config_dir(),
            "HERDR_PLUGIN_STATE_DIR": ctx.state_dir(),
            "HERDR_CONFIG_PATH": ctx.herdr_config_path(),
            "HERDR_SOCKET_PATH": ctx.socket_path(),
            "HERDR_BIN_PATH": ctx.herdr_bin(),
        })
        with open(os.path.join(ctx.state_dir(), "refresh.log"), "a") as log:
            subprocess.Popen(
                ["/usr/bin/python3", os.path.join(ctx.plugin_root(), "src", "main.py"),
                 "refresh-worker", key], env=env, cwd=ctx.plugin_root(),
                stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                close_fds=True, start_new_session=True,
            )


def run(key):
    lock_name, heartbeat = paths(key)
    try:
        lock = ctx.Lock(lock_name, timeout=0)
        lock.__enter__()
    except RuntimeError:
        return 0  # Another startup/event won the singleton race.
    try:
        while True:
            started = time.monotonic()
            try:
                with ctx.Lock():
                    if generation() != key or not registered():
                        return 0
                    st = state.load()
                    if not st.get("sidebar_installed"):
                        return 0
                    count = sidebar.publish(st)
                    ctx.atomic_write(heartbeat, json.dumps({
                        "pid": os.getpid(), "published_at": time.time(),
                        "agents": count, "duration_seconds": time.monotonic() - started,
                    }) + "\n")
            except (OSError, rpc.RpcError, RuntimeError) as error:
                # A failed round leaves durable titles intact; elapsed expires.
                # An unavailable/replaced server belongs to a different startup.
                with ctx.Lock():
                    ctx.warn("sidebar refresh failed: %s" % error)
                if isinstance(error, OSError) or (isinstance(error, rpc.RpcError)
                                               and error.code == "socket_unavailable"):
                    return 1
            time.sleep(max(0, INTERVAL_SECONDS - (time.monotonic() - started)))
    finally:
        lock.__exit__(None, None, None)


def status():
    """Read the most recent completed round for the current socket generation."""
    try:
        _, path = paths(generation())
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None
