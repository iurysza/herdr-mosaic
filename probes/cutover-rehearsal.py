#!/usr/bin/env python3
"""Isolated Window Manager migrate/install/uninstall rehearsal. No live mutations."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import tomllib
from pathlib import Path

HERDR_BIN = "/Users/iurysouza/.local/bin/herdr"
PYTHON = "/usr/bin/python3"
SESSION = "wmr"
LIVE_HOME = Path("/Users/iurysouza")
LIVE_CONFIG = LIVE_HOME / ".config" / "herdr" / "config.toml"
LIVE_PLUGINS = LIVE_HOME / ".config" / "herdr" / "plugins.json"
LIVE_SOCKET = LIVE_HOME / ".config" / "herdr" / "herdr.sock"
LIVE_CHROMATIC_STATE = (
    LIVE_HOME / ".local" / "state" / "herdr" / "plugins"
    / "jackfrancisdalton.chromatic-spaces" / "state.json"
)
WM_ROOT = Path("/Users/iurysouza/dev/personal/tools/herdr-window-manager")
CHROMATIC_ID = "jackfrancisdalton.chromatic-spaces"
CHROMATIC_ROOT = Path(
    "/Users/iurysouza/.config/herdr/plugins/github/"
    "jackfrancisdalton.chromatic-spaces-91c6cfbb4074"
)
LAYOUTS_ROOT = Path("/Users/iurysouza/dev/personal/tools/herdr-pane-layouts")
IDENTITIES_SRC = Path(
    "/Users/iurysouza/dev/personal/dotfiles/dot_config/herdr/"
    "chromatic-spaces-identities.json"
)
EVIDENCE = WM_ROOT / "probes" / "evidence" / "cutover-rehearsal-lifecycle.log"
LAYOUT_COMMANDS = {
    "layouts.resize-left": "iurysza.window-manager.resize-left",
    "layouts.resize-down": "iurysza.window-manager.resize-down",
    "layouts.resize-up": "iurysza.window-manager.resize-up",
    "layouts.resize-right": "iurysza.window-manager.resize-right",
    "layouts.equalize": "iurysza.window-manager.equalize",
    "layouts.cycle": "iurysza.window-manager.cycle",
}
LAYOUT_KEYS = {
    "ctrl+alt+h": "iurysza.window-manager.resize-left",
    "ctrl+alt+j": "iurysza.window-manager.resize-down",
    "ctrl+alt+k": "iurysza.window-manager.resize-up",
    "ctrl+alt+l": "iurysza.window-manager.resize-right",
    "ctrl+backslash": "iurysza.window-manager.equalize",
    "prefix+space": "iurysza.window-manager.cycle",
}
PRESERVED_BINDINGS = {
    "prefix+i": "jt.command-palette.open",
    "prefix+w": "fullerzz.sesh.open-picker",
    "cmd+3": "fullerzz.sesh.open-picker",
    "prefix+shift+b": "fullerzz.sesh.last",
}


def sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fail(message: str) -> None:
    print("FAIL", message, file=sys.stderr)
    raise SystemExit(1)


def make_env(root: Path, config_path: Path) -> dict[str, str]:
    for name in ("config", "data", "cache", "state", "runtime", "tmp", "zsh"):
        (root / name).mkdir(parents=True, exist_ok=True)
    (root / "config" / "herdr" / "sessions" / SESSION).mkdir(parents=True, exist_ok=True)
    return {
        "HOME": str(root),
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "XDG_STATE_HOME": str(root / "state"),
        "XDG_RUNTIME_DIR": str(root / "runtime"),
        "ZDOTDIR": str(root / "zsh"),
        "TMPDIR": str(root / "tmp"),
        "HERDR_CONFIG_PATH": str(config_path),
        "HERDR_SESSION": SESSION,
        "HERDR_BIN_PATH": HERDR_BIN,
        "PATH": "/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TERM": "xterm-256color",
        "SHELL": "/bin/sh",
        "USER": "herdr-cutover-rehearsal",
        "LOGNAME": "herdr-cutover-rehearsal",
    }


def rpc(sock_path: Path, method: str, params: dict) -> dict:
    request_id = "cutover-%s" % time.monotonic_ns()
    payload = json.dumps({"id": request_id, "method": method, "params": params}) + "\n"
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(10.0)
        sock.connect(str(sock_path))
        sock.sendall(payload.encode())
        stream = sock.makefile("rb")
        for raw in stream:
            if not raw.strip():
                continue
            message = json.loads(raw.decode())
            if message.get("id") == request_id:
                return message
    fail("no rpc reply for %s on %s" % (method, sock_path))
    raise AssertionError("unreachable")


def stop_server(proc: subprocess.Popen[bytes] | None, sock_path: Path) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.kill(proc.pid, signal.SIGKILL)
        proc.wait(timeout=5)
    deadline = time.monotonic() + 2
    while sock_path.exists() and time.monotonic() < deadline:
        time.sleep(0.05)


def run(env: dict[str, str], args: list[str], cwd: Path, timeout: float = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def herdr(env: dict[str, str], args: list[str], cwd: Path, timeout: float = 30) -> subprocess.CompletedProcess[str]:
    return run(env, [HERDR_BIN, "--session", SESSION] + args, cwd, timeout)


def require_ok(result: subprocess.CompletedProcess[str], label: str) -> None:
    if result.returncode != 0:
        fail("%s exit %s stdout=%s stderr=%s" % (
            label, result.returncode, result.stdout[-1500:], result.stderr[-1500:]))


def first_json_object(text: str) -> dict:
    decoder = json.JSONDecoder()
    idx = text.find("{")
    if idx < 0:
        fail("no JSON object in output: %s" % text[-500:])
    obj, _end = decoder.raw_decode(text[idx:])
    if not isinstance(obj, dict):
        fail("expected JSON object, got %s" % type(obj).__name__)
    return obj


def plugin_map(env: dict[str, str], cwd: Path) -> dict[str, dict]:
    result = herdr(env, ["plugin", "list", "--json"], cwd)
    require_ok(result, "plugin list")
    payload = json.loads(result.stdout)
    plugins = payload.get("result", {}).get("plugins") or []
    return {p["plugin_id"]: p for p in plugins if isinstance(p, dict) and p.get("plugin_id")}


def binding_commands(config_text: str) -> dict[str, str]:
    out = {}
    for block in re.findall(r"(?ms)^\[\[keys\.command\]\]\n.*?(?=^\[|\Z)", config_text):
        key = re.search(r'(?m)^key = "(.+)"$', block)
        command = re.search(r'(?m)^command = "(.+)"$', block)
        if key and command:
            out[key.group(1)] = command.group(1)
    return out


def row_tokens(row: object) -> list[str]:
    tokens = []
    if not isinstance(row, list):
        return tokens
    for entry in row:
        if isinstance(entry, str):
            tokens.append(entry)
        elif isinstance(entry, dict) and isinstance(entry.get("token"), str):
            tokens.append(entry["token"])
    return tokens


def assert_rows(config_text: str) -> None:
    parsed = tomllib.loads(config_text)
    spaces = parsed["ui"]["sidebar"]["spaces"]["rows"]
    agents = parsed["ui"]["sidebar"]["agents"]["rows"]
    space_tokens = row_tokens(spaces[0])
    agent_tokens = row_tokens(agents[0])
    print("space_row_tokens", len(space_tokens), space_tokens[:3], "...", space_tokens[-1:])
    print("agent_row_tokens", len(agent_tokens), agent_tokens)
    if len(agent_tokens) != 15:
        fail("agent row token count %d, expected 15" % len(agent_tokens))
    if agent_tokens[0] != "state_icon" or agent_tokens[1] != "$elapsed":
        fail("agent row does not start with state_icon $elapsed")
    if agent_tokens[-1] != "$themed_model_tier":
        fail("agent row missing $themed_model_tier")
    titles = [tok for tok in agent_tokens if tok.startswith("$title_")]
    if len(titles) != 12:
        fail("expected 12 $title_* tokens, got %d" % len(titles))
    dots = [tok for tok in space_tokens if tok.startswith("$sd_")]
    if len(dots) != 12:
        fail("expected 12 $sd_* tokens, got %d" % len(dots))
    if "$sd_rose" not in space_tokens or "workspace" not in space_tokens:
        fail("spaces row missing $sd_rose or workspace")


def remap_layout_commands(config_path: Path) -> None:
    text = config_path.read_text()
    updated = text
    for old, new in LAYOUT_COMMANDS.items():
        updated = updated.replace('command = "%s"' % old, 'command = "%s"' % new)
    if updated == text:
        fail("layout commands were not present to remap")
    config_path.write_text(updated)


def collect_sources(obj, found=None):
    if found is None:
        found = []
    if isinstance(obj, dict):
        source = obj.get("source")
        if isinstance(source, str):
            found.append(source)
        for value in obj.values():
            collect_sources(value, found)
    elif isinstance(obj, list):
        for value in obj:
            collect_sources(value, found)
    return found


def snapshot_sources(env: dict[str, str], cwd: Path) -> list[str]:
    result = herdr(env, ["api", "snapshot"], cwd)
    require_ok(result, "snapshot")
    payload = json.loads(result.stdout)
    return sorted(set(collect_sources(payload)))


def live_unchanged(before_plugins: str | None, before_config: str | None, isolated_config: Path) -> None:
    after_plugins = sha256(LIVE_PLUGINS)
    after_config = sha256(LIVE_CONFIG)
    print("live_plugins_after", after_plugins)
    print("live_config_after", after_config)
    if after_plugins != before_plugins:
        fail("live plugins.json hash changed")
    if isolated_config.resolve() == LIVE_CONFIG.resolve():
        fail("isolated config resolved to live config")
    if after_config != before_config:
        live = LIVE_CONFIG.read_text()
        if "iurysza.window-manager." in live:
            fail("live config gained Window Manager commands")
        print("live_config_hash_changed_without_wm_commands")


def main() -> int:
    for path, label in (
        (Path(HERDR_BIN), "herdr"),
        (WM_ROOT / "src" / "main.py", "window-manager main"),
        (CHROMATIC_ROOT / "herdr-plugin.toml", "chromatic plugin"),
        (LAYOUTS_ROOT / "herdr-plugin.toml", "layouts plugin"),
        (LIVE_CONFIG, "live config"),
        (LIVE_CHROMATIC_STATE, "chromatic state"),
        (IDENTITIES_SRC, "identities source"),
    ):
        if not path.exists():
            fail("missing %s: %s" % (label, path))
    before_plugins = sha256(LIVE_PLUGINS)
    before_config = sha256(LIVE_CONFIG)
    if not LIVE_SOCKET.exists():
        fail("live socket missing; refusing to guess")

    root = Path(tempfile.mkdtemp(prefix="wmcr.", dir="/tmp"))
    keep_root = False
    config_path = root / "config" / "herdr" / "config.toml"
    socket_path = root / "config" / "herdr" / "sessions" / SESSION / "herdr.sock"
    stdout_path = root / "server.stdout"
    stderr_path = root / "server.stderr"
    env = make_env(root, config_path)
    wm_state_dir = root / "state" / "herdr" / "plugins" / "iurysza.window-manager"
    wm_config_dir = root / "config" / "herdr" / "plugins" / "config" / "iurysza.window-manager"
    chromatic_state_dir = root / "legacy" / "chromatic"
    seed_dir = root / "seed"
    for path in (wm_state_dir, wm_config_dir, chromatic_state_dir, seed_dir):
        path.mkdir(parents=True, exist_ok=True)

    shutil.copy2(LIVE_CONFIG, config_path)
    shutil.copy2(LIVE_CONFIG, seed_dir / "config.toml")
    shutil.copy2(LIVE_CHROMATIC_STATE, chromatic_state_dir / "state.json")
    shutil.copy2(IDENTITIES_SRC, config_path.parent / "chromatic-spaces-identities.json")
    seeded = json.loads((chromatic_state_dir / "state.json").read_text())
    print("root", root)
    print("config", config_path)
    print("socket", socket_path)
    print("seeded_identities", len(seeded.get("identities") or {}))
    print("seeded_tint_enabled", seeded.get("tint_enabled"))
    print("live_plugins_before", before_plugins)
    print("live_config_before", before_config)

    env["HERDR_PLUGIN_ROOT"] = str(WM_ROOT)
    env["HERDR_PLUGIN_STATE_DIR"] = str(wm_state_dir)
    env["HERDR_PLUGIN_CONFIG_DIR"] = str(wm_config_dir)
    env["HERDR_LEGACY_CHROMATIC_STATE_DIR"] = str(chromatic_state_dir)
    env["HERDR_LABEL_IDENTITIES_FILE"] = str(config_path.parent / "chromatic-spaces-identities.json")

    if socket_path.resolve() == LIVE_SOCKET.resolve() or config_path.resolve() == LIVE_CONFIG.resolve():
        fail("isolated paths resolved to live paths")
    if "HERDR_SOCKET_PATH" in env:
        fail("isolated env leaked HERDR_SOCKET_PATH")
    if len(str(socket_path)) >= 104:
        fail("isolated socket path exceeds sun_path: %s (%d)" % (socket_path, len(str(socket_path))))

    proc: subprocess.Popen[bytes] | None = None
    try:
        stdout = stdout_path.open("wb")
        stderr = stderr_path.open("wb")
        proc = subprocess.Popen(
            [HERDR_BIN, "--session", SESSION, "server"],
            cwd=str(root),
            env=env,
            stdout=stdout,
            stderr=stderr,
            start_new_session=True,
        )
        stdout.close()
        stderr.close()
        print("pid", proc.pid)
        deadline = time.monotonic() + 10
        ready = False
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                fail("isolated server exited %s stderr=%s" % (
                    proc.returncode, stderr_path.read_text()[-2000:]))
            if socket_path.exists():
                try:
                    reply = rpc(socket_path, "ping", {})
                except (OSError, TimeoutError, json.JSONDecodeError):
                    time.sleep(0.05)
                    continue
                if "error" in reply:
                    time.sleep(0.05)
                    continue
                print("ping", json.dumps(reply.get("result") or {}, sort_keys=True))
                ready = True
                break
            time.sleep(0.05)
        if not ready:
            fail("isolated socket not ready; stderr=%s" % stderr_path.read_text()[-2000:])
        if os.path.samefile(socket_path, LIVE_SOCKET):
            fail("isolated socket is the live socket")
        env["HERDR_SOCKET_PATH"] = str(socket_path)

        empty = plugin_map(env, root)
        if empty:
            fail("isolated registry was not empty before staging: %s" % sorted(empty))

        require_ok(herdr(env, ["plugin", "link", str(CHROMATIC_ROOT)], root), "link chromatic")
        require_ok(herdr(env, ["plugin", "link", str(LAYOUTS_ROOT)], root), "link layouts")
        require_ok(herdr(env, ["plugin", "link", str(WM_ROOT), "--disabled"], root), "link window-manager disabled")
        staged = plugin_map(env, root)
        print("staged", {pid: {"enabled": p.get("enabled"), "root": p.get("plugin_root")} for pid, p in staged.items()})
        if staged.get("iurysza.window-manager", {}).get("enabled") is not False:
            fail("window-manager was not staged disabled")
        if not staged.get("jackfrancisdalton.chromatic-spaces", {}).get("enabled"):
            fail("chromatic was not staged enabled")
        if not staged.get("layouts", {}).get("enabled"):
            fail("layouts was not staged enabled")

        check = herdr(env, ["config", "check"], root)
        print("config_check_seed", check.returncode, check.stdout.strip()[:300])
        require_ok(check, "config check seed")
        shutil.copy2(config_path, seed_dir / "config-before-retire.toml")

        require_ok(herdr(env, ["plugin", "disable", CHROMATIC_ID], root), "disable chromatic")
        sources_after_disable = snapshot_sources(env, root)
        print("sources_after_chromatic_disable", sources_after_disable)
        clear_raw = rpc(socket_path, "agent.view.clear", {"source": CHROMATIC_ID})
        print("chromatic_view_clear", json.dumps(clear_raw, sort_keys=True)[:500])
        print("sources_after_chromatic_clear", snapshot_sources(env, root))
        require_ok(herdr(env, ["plugin", "unlink", "layouts"], root), "unlink layouts")
        retired = plugin_map(env, root)
        print("retired_before_wm", {pid: p.get("enabled") for pid, p in retired.items()})
        if retired.get(CHROMATIC_ID, {}).get("enabled") is not False:
            fail("chromatic was not disabled before Window Manager enable")
        if "layouts" in retired:
            fail("layouts remained registered before Window Manager enable")
        if retired.get("iurysza.window-manager", {}).get("enabled") is not False:
            fail("window-manager must stay disabled until after Chromatic/layouts retire")

        require_ok(herdr(env, ["plugin", "enable", "iurysza.window-manager"], root), "enable window-manager")
        migrate = run(env, [PYTHON, str(WM_ROOT / "src" / "main.py"), "migrate"], WM_ROOT)
        print("migrate_stdout", migrate.stdout[-2000:])
        print("migrate_stderr", migrate.stderr[-1000:])
        require_ok(migrate, "migrate")
        report = first_json_object(migrate.stdout)
        ignored = set(report.get("ignored_stale_backups") or [])
        print("ignored_stale_backups", sorted(ignored))
        if not {"sidebar_backup", "theme_backup", "last_written"} <= ignored:
            fail("migrate did not ignore stale Chromatic backups")
        if len(report.get("identities_imported") or []) < 1:
            fail("migrate imported no identities")
        install = run(env, [PYTHON, str(WM_ROOT / "src" / "main.py"), "install"], WM_ROOT, timeout=60)
        print("install_stdout", install.stdout[-2000:])
        print("install_stderr", install.stderr[-1000:])
        require_ok(install, "install")

        bind = run(
            env,
            [PYTHON, str(WM_ROOT / "src" / "main.py"), "keybind-install", "key=prefix+shift+i"],
            WM_ROOT,
        )
        print("bind_stdout", bind.stdout.strip())
        require_ok(bind, "bind picker prefix+shift+i")
        remap_layout_commands(config_path)
        tint = run(env, [PYTHON, str(WM_ROOT / "src" / "main.py"), "tint-enable"], WM_ROOT)
        print("tint_stdout", tint.stdout.strip())
        require_ok(tint, "tint-enable")

        check = herdr(env, ["config", "check"], root)
        print("config_check_installed", check.returncode, check.stdout.strip()[:300])
        require_ok(check, "config check installed")
        installed_text = config_path.read_text()
        assert_rows(installed_text)
        binds = binding_commands(installed_text)
        print("bindings", {k: binds.get(k) for k in sorted(set(PRESERVED_BINDINGS) | set(LAYOUT_KEYS) | {"prefix+shift+i"})})
        for key, command in PRESERVED_BINDINGS.items():
            if binds.get(key) != command:
                fail("binding %s is %r, expected %s" % (key, binds.get(key), command))
        for key, command in LAYOUT_KEYS.items():
            if binds.get(key) != command:
                fail("layout binding %s is %r, expected %s" % (key, binds.get(key), command))
        if any(value.startswith("layouts.") for value in binds.values()):
            fail("legacy layouts.* commands still bound")
        if binds.get("prefix+shift+i") != "iurysza.window-manager.set-identity":
            fail("picker was not bound to prefix+shift+i")

        wm_state = json.loads((wm_state_dir / "state.json").read_text())
        print("wm_identities", len(wm_state.get("identities") or {}))
        print("wm_tint_enabled", wm_state.get("tint_enabled"))
        print("wm_view_mode", wm_state.get("view_mode"))
        sources_after_install = snapshot_sources(env, root)
        print("sources_after_install", sources_after_install)
        views_after = [s for s in sources_after_install if s in (CHROMATIC_ID, "plugin:" + CHROMATIC_ID, "iurysza.window-manager", "plugin:iurysza.window-manager")]
        print("view_sources_after_install", views_after)
        if CHROMATIC_ID in views_after or ("plugin:" + CHROMATIC_ID) in views_after:
            fail("Chromatic agent-view source still present after Window Manager install")
        if len(wm_state.get("identities") or {}) < len(seeded.get("identities") or {}):
            fail("window-manager identities fewer than seeded Chromatic identities")
        if wm_state.get("tint_enabled") is not True:
            fail("tint setting was not enabled after tint-enable")
        if wm_state.get("view_mode") != "all":
            fail("view_mode was not migrated/installed as all")
        retired = plugin_map(env, root)
        print("retired", {pid: p.get("enabled") for pid, p in retired.items()})
        if retired.get(CHROMATIC_ID, {}).get("enabled") is not False:
            fail("chromatic was not disabled")
        if "layouts" in retired:
            fail("layouts remained registered after unlink")
        if retired.get("iurysza.window-manager", {}).get("enabled") is not True:
            fail("window-manager was not left enabled")

        after_cutover = sha256(config_path)
        install2 = run(env, [PYTHON, str(WM_ROOT / "src" / "main.py"), "install"], WM_ROOT, timeout=60)
        print("install2_stdout", install2.stdout[-1500:])
        require_ok(install2, "second install")
        if sha256(config_path) != after_cutover:
            fail("second install was not idempotent; config hash changed")
        assert_rows(config_path.read_text())

        uninstall = run(env, [PYTHON, str(WM_ROOT / "src" / "main.py"), "uninstall"], WM_ROOT, timeout=60)
        print("uninstall_stdout", uninstall.stdout[-1500:])
        require_ok(uninstall, "uninstall")
        shutil.copy2(seed_dir / "config.toml", config_path)
        require_ok(herdr(env, ["plugin", "disable", "iurysza.window-manager"], root), "disable window-manager after rollback")
        require_ok(herdr(env, ["plugin", "enable", "jackfrancisdalton.chromatic-spaces"], root), "re-enable chromatic")
        require_ok(herdr(env, ["plugin", "link", str(LAYOUTS_ROOT)], root), "relink layouts")
        rolled = plugin_map(env, root)
        print("rolled_back", {pid: p.get("enabled") for pid, p in rolled.items()})
        if sha256(config_path) != sha256(seed_dir / "config.toml"):
            fail("rollback did not restore seeded config snapshot")
        check = herdr(env, ["config", "check"], root)
        require_ok(check, "config check rollback")
        rolled_text = config_path.read_text()
        assert_rows(rolled_text)
        rolled_binds = binding_commands(rolled_text)
        if rolled_binds.get("ctrl+backslash") != "layouts.equalize":
            fail("rollback lost layouts.equalize")
        if rolled_binds.get("prefix+i") != "jt.command-palette.open":
            fail("rollback lost command palette")
        if rolled.get("jackfrancisdalton.chromatic-spaces", {}).get("enabled") is not True:
            fail("chromatic was not restored enabled")
        if rolled.get("layouts", {}).get("enabled") is not True:
            fail("layouts was not restored")
        if rolled.get("iurysza.window-manager", {}).get("enabled") is not False:
            fail("window-manager was not disabled after rollback")

        live_unchanged(before_plugins, before_config, config_path)
        EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
        EVIDENCE.write_text(
            "\n".join([
                "root %s" % root,
                "pid %s" % proc.pid,
                "seeded_identities %s" % len(seeded.get("identities") or {}),
                "wm_identities %s" % len(wm_state.get("identities") or {}),
                "wm_tint_enabled %s" % wm_state.get("tint_enabled"),
                "ignored_stale_backups %s" % sorted(ignored),
                "live_plugins_before %s" % before_plugins,
                "live_plugins_after %s" % sha256(LIVE_PLUGINS),
                "live_config_before %s" % before_config,
                "live_config_after %s" % sha256(LIVE_CONFIG),
                "OK isolated migrate/install/uninstall rehearsal",
            ]) + "\n"
        )
        print("evidence", EVIDENCE)
        print("OK isolated migrate/install/uninstall rehearsal")
        return 0
    except Exception:
        keep_root = True
        raise
    finally:
        stop_server(proc, socket_path)
        if proc is not None and proc.poll() is None:
            fail("isolated server still running after stop")
        if keep_root:
            print("kept_root", root)
        else:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
