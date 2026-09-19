#!/usr/bin/env python3
"""Drive a child over a PTY: send bytes, resize, and capture output."""

import errno
import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time


def resize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: pty-session.py <command> [args...]")
    pid, master = pty.fork()
    if pid == 0:
        os.execvp(sys.argv[1], sys.argv[1:])
    collected = bytearray()
    deadline = time.monotonic() + 5
    sent_key = False
    resized = False
    sent_cancel = False
    try:
        resize(master, 24, 80)
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.05)
            if ready:
                try:
                    chunk = os.read(master, 1024)
                except OSError as exc:
                    if exc.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                collected.extend(chunk)
                text = collected.decode("utf-8", "replace")
                if "raw:1" in text and not sent_key:
                    os.write(master, b"x")
                    sent_key = True
                if sent_key and "key:78" in text and not resized:
                    resize(master, 12, 40)
                    resized = True
                if resized and "resize:" in text and not sent_cancel:
                    os.write(master, b"\x03")
                    sent_cancel = True
                if "restored:1" in text:
                    break
            _, status = os.waitpid(pid, os.WNOHANG)
            if status != 0:
                break
        _, status = os.waitpid(pid, 0)
    finally:
        os.close(master)
    sys.stdout.buffer.write(bytes(collected))
    raise SystemExit(os.waitstatus_to_exitcode(status) if os.WIFEXITED(status) else 1)


if __name__ == "__main__":
    main()
