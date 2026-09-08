#!/usr/bin/env python3
"""Capture one real terminal key event for the Herdr host gate.

Run in a focused Ghostty/Herdr test pane. This probe never sends input and never
calls the Herdr API. The operator must press Ctrl+Tab physically; injected input
is not valid evidence for the physical-key gate.
"""

from __future__ import annotations

import json
import os
import select
import sys
import termios
import time
import tty
from datetime import datetime, timezone
from pathlib import Path




def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def evidence_path() -> Path:
    configured = os.environ.get("HM_CTRL_TAB_EVIDENCE")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parent / "evidence" / "ctrl-tab-capture.json"


def capture() -> dict[str, object]:
    if not os.isatty(sys.stdin.fileno()):
        raise RuntimeError("stdin is not a terminal; run this probe in a Herdr pane")

    fd = sys.stdin.fileno()
    original = termios.tcgetattr(fd)
    started = time.monotonic()
    chunks: list[bytes] = []

    tty.setraw(fd)
    try:
        print("READY: focus this pane in Ghostty and press Ctrl+Tab once physically", flush=True)
        while True:
            readable, _, _ = select.select([fd], [], [], 0.5)
            if not readable:
                continue
            chunk = os.read(fd, 4096)
            if not chunk:
                break
            chunks.append(chunk)
            # The first received terminal event is enough. Do not ask the
            # operator to press the key twice or synthesize another event.
            break
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, original)

    raw = b"".join(chunks)
    return {
        "probe": "physical-ctrl-tab",
        "captured_at_utc": utc_now(),
        "duration_ms": round((time.monotonic() - started) * 1000),
        "timed_out": False,
        "received": bool(raw),
        "bytes_hex": raw.hex(),
        "bytes_decimal": list(raw),
        "operator_attestation_required": True,
        "note": "A capture is not physical-key evidence until the coordinator confirms the operator pressed Ctrl+Tab in this pane.",
    }


def main() -> int:
    try:
        result = capture()
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    path = evidence_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True), flush=True)
    print(f"EVIDENCE: {path}", flush=True)
    return 0 if result["received"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
