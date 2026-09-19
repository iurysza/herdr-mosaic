#!/bin/sh
# Pin the public Herdr CLI used by `herdr config check` and isolated proofs.
# Receipt: https://herdr.dev/latest.json for v0.9.0 on 2026-09-08.
set -eu

VERSION="0.9.0"
DEST="${1:-${HOME}/.local/bin/herdr}"

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "${uname_s}-${uname_m}" in
  Linux-x86_64)
    TARGET="linux-x86_64"
    SHA256="4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f"
    ;;
  Linux-aarch64|Linux-arm64)
    TARGET="linux-aarch64"
    SHA256="9c8db20fb7e7427b138d5367113f1621ffd319f2f65d6f009e2594029115f0d2"
    ;;
  Darwin-x86_64)
    TARGET="macos-x86_64"
    SHA256="d0c920b2a126a74809fa1491411c9a097a44786cac9c2ca51b818a995581cf16"
    ;;
  Darwin-arm64)
    TARGET="macos-aarch64"
    SHA256="32b53df09872628059c789a69f02a6b8e29e14ddf26711421f3463f70c1aef17"
    ;;
  *)
    echo "unsupported herdr target: ${uname_s} ${uname_m}" >&2
    exit 1
    ;;
esac

URL="https://github.com/herdrdev/herdr/releases/download/v${VERSION}/herdr-${TARGET}"

mkdir -p "$(dirname "$DEST")"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsSL --retry 3 --connect-timeout 10 --max-time 120 "$URL" -o "$TMP"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP" | awk '{ print $1 }')"
else
  ACTUAL="$(shasum -a 256 "$TMP" | awk '{ print $1 }')"
fi

if [ "$ACTUAL" != "$SHA256" ]; then
  echo "herdr checksum mismatch for ${TARGET}: got $ACTUAL expected $SHA256" >&2
  exit 1
fi

mv "$TMP" "$DEST"
chmod +x "$DEST"
trap - EXIT
"$DEST" --version
