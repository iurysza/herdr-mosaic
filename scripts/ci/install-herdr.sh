#!/bin/sh
# Pin the public Herdr CLI used by `herdr config check` in CI.
# Receipt: https://herdr.dev/latest.json for v0.9.0 linux-x86_64 on 2026-09-08.
set -eu

VERSION="0.9.0"
TARGET="linux-x86_64"
SHA256="4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f"
URL="https://github.com/herdrdev/herdr/releases/download/v${VERSION}/herdr-${TARGET}"
DEST="${1:-${HOME}/.local/bin/herdr}"

mkdir -p "$(dirname "$DEST")"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsSL --retry 3 --connect-timeout 10 --max-time 120 "$URL" -o "$TMP"
ACTUAL="$(sha256sum "$TMP" | awk '{ print $1 }')"
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "herdr checksum mismatch: got $ACTUAL expected $SHA256" >&2
  exit 1
fi

mv "$TMP" "$DEST"
chmod +x "$DEST"
trap - EXIT
"$DEST" --version
