#!/usr/bin/env python3
"""Drive a child over a PTY using a JSON step script.

Steps:
  {"wait": "text"}
  {"send": "q"}
  {"send_bytes": "1b5b41"}
  {"resize": [12, 40]}
  {"sleep_ms": 50}
"""

import argparse
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def resize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def collected_text(collected):
    return bytes(collected).decode("utf-8", "replace")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=24)
    parser.add_argument("--cols", type=int, default=80)
    parser.add_argument("--timeout", type=float, default=6)
    parser.add_argument("--script", default="[]")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command

    if command and command[0] == "--":
        command = command[1:]

    if not command:
        raise SystemExit("usage: pty-drive.py [--script JSON] -- command...")

    steps = json.loads(args.script)
    pid, master = pty.fork()

    if pid == 0:
        os.execvp(command[0], command)

    collected = bytearray()
    index = 0
    deadline = time.monotonic() + args.timeout
    status = 0

    try:
        resize(master, args.rows, args.cols)

        while time.monotonic() < deadline:
            if index < len(steps):
                step = steps[index]
                wait = step.get("wait")
                send = step.get("send")
                send_bytes = step.get("send_bytes")
                size = step.get("resize")
                sleep_ms = step.get("sleep_ms")

                if wait is not None:
                    if wait in collected_text(collected):
                        index += 1
                        continue
                elif send is not None:
                    os.write(master, send.encode("utf-8"))
                    index += 1
                    continue
                elif send_bytes is not None:
                    os.write(master, bytes.fromhex(send_bytes))
                    index += 1
                    continue
                elif size is not None:
                    resize(master, int(size[0]), int(size[1]))
                    index += 1
                    continue
                elif sleep_ms is not None:
                    time.sleep(float(sleep_ms) / 1000.0)
                    index += 1
                    continue
                else:
                    index += 1
                    continue

            ready, _, _ = select.select([master], [], [], 0.05)

            if ready:
                try:
                    chunk = os.read(master, 4096)
                except OSError as exc:
                    if exc.errno == errno.EIO:
                        break
                    raise

                if not chunk:
                    break

                collected.extend(chunk)

            waited, child_status = os.waitpid(pid, os.WNOHANG)

            if waited == pid:
                status = child_status
                pid = 0
                break

        if pid:
            end = time.monotonic() + 1

            while time.monotonic() < end:
                waited, child_status = os.waitpid(pid, os.WNOHANG)

                if waited == pid:
                    status = child_status
                    pid = 0
                    break

                time.sleep(0.05)

            if pid:
                os.kill(pid, signal.SIGKILL)
                _, status = os.waitpid(pid, 0)
    finally:
        os.close(master)

    sys.stdout.buffer.write(bytes(collected))
    sys.stderr.write("steps=%d/%d\n" % (index, len(steps)))

    if os.WIFEXITED(status):
        raise SystemExit(os.WEXITSTATUS(status))

    raise SystemExit(1)


if __name__ == "__main__":
    main()
