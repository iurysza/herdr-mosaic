#!/usr/bin/env python3
"""Fail if the frozen Python entrypoints are missing from the parity inventory.

Reads COMMANDS and CLI_ALIASES from src/main.py and [[startup]], [[events]],
[[panes]], and [[actions]] from herdr-plugin.toml. Each entry must appear in
ai-artifacts/goals/mosaic-typescript-port/parity.md as a backtick-quoted
inventory ID. This check does not import plugin modules.
"""
from __future__ import print_function

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "src", "main.py")
MANIFEST = os.path.join(ROOT, "herdr-plugin.toml")
PARITY = os.path.join(
    ROOT, "ai-artifacts", "goals", "mosaic-typescript-port", "parity.md"
)
REF = "8b7bb76cf88e9be0452f126209aa58f84be0b0ed"


def _read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def _block(src, name):
    match = re.search(r"^%s = \{([^}]+)\}" % name, src, re.M)
    if not match:
        raise SystemExit("could not parse %s" % name)
    return match.group(1)


def command_ids(src):
    return re.findall(r'"([^"]+)":', _block(src, "COMMANDS"))


def alias_ids(src):
    return re.findall(r'"([^"]+)":', _block(src, "CLI_ALIASES"))


def toml_section_ids(text, header, field):
    parts = text.split(header)
    ids = []
    for part in parts[1:]:
        match = re.search(r"^%s = \"([^\"]+)\"" % field, part, re.M)
        if match:
            ids.append(match.group(1))
    return ids


def required_ids():
    main = _read(MAIN)
    manifest = _read(MANIFEST)
    required = []
    for name in command_ids(main):
        required.append(("cmd-" + name, "command " + name))
    for name in alias_ids(main):
        required.append(("alias-" + name, "alias " + name))
    if (
        'main.py" reconcile' in manifest
        or 'main.py\\" reconcile' in manifest
        or 'mosaic" reconcile' in manifest
        or 'mosaic\\" reconcile' in manifest
    ):
        required.append(("startup-reconcile", "startup reconcile"))
    for name in toml_section_ids(manifest, "[[events]]", "on"):
        required.append(("event-" + name, "event " + name))
    for name in toml_section_ids(manifest, "[[panes]]", "id"):
        required.append(("pane-" + name, "pane " + name))
    for name in toml_section_ids(manifest, "[[actions]]", "id"):
        required.append(("action-" + name, "action " + name))
    return required


def main():
    if not os.path.isfile(PARITY):
        print("missing inventory: %s" % PARITY, file=sys.stderr)
        return 1
    inventory = _read(PARITY)
    if REF not in inventory:
        print("parity.md does not name frozen revision %s" % REF, file=sys.stderr)
        return 1
    missing = []
    for ident, label in required_ids():
        if "`%s`" % ident not in inventory:
            missing.append("%s (%s)" % (ident, label))
    if missing:
        print("parity.md missing %d inventory ids:" % len(missing), file=sys.stderr)
        for item in missing:
            print("  - %s" % item, file=sys.stderr)
        return 1
    print("parity inventory covers %d frozen entrypoints" % len(required_ids()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
