#!/bin/sh
# Owner-run native proofs for lock, TTY, compiled PATH, and isolated Herdr.
# Linux already has evidence in ai-artifacts/goals/mosaic-typescript-port/.
# macOS results belong in that evidence directory after this script passes.
set -eu

cd "$(dirname "$0")/.."

bun run typecheck
bun run lint
bun run test:runtime
bun run build
bun run test:artifact

if [ -z "${HERDR_BIN_PATH:-}" ]; then
  HERDR_BIN_PATH="${HOME}/.local/bin/herdr"
  export HERDR_BIN_PATH
fi

export MOSAIC_HERDR_BIN="${MOSAIC_HERDR_BIN:-$HERDR_BIN_PATH}"

if [ ! -x "$HERDR_BIN_PATH" ]; then
  bash scripts/ci/install-herdr.sh "$HERDR_BIN_PATH"
fi

bun run test:herdr

os="$(uname -s)"
arch="$(uname -m)"
receipt="ai-artifacts/goals/mosaic-typescript-port/evidence/native-runtime-${os}-${arch}.json"
uname_a="$(uname -a | sed 's/"/\\"/g')"
bun_v="$(bun --version)"
herdr_v="$("$HERDR_BIN_PATH" --version 2>/dev/null || printf unknown)"
herdr_v="$(printf '%s' "$herdr_v" | tr '\n' ' ' | sed 's/"/\\"/g; s/[[:space:]]*$//')"

{
  printf '{\n'
  printf '  "os": "%s",\n' "$os"
  printf '  "arch": "%s",\n' "$arch"
  printf '  "uname": "%s",\n' "$uname_a"
  printf '  "bun": "%s",\n' "$bun_v"
  printf '  "herdr_bin": "%s",\n' "$HERDR_BIN_PATH"
  printf '  "herdr_version": "%s",\n' "$herdr_v"
  printf '  "checks": ["typecheck","lint","test:runtime","build","test:artifact","test:herdr"],\n'
  printf '  "result": "passed"\n'
  printf '}\n'
} > "$receipt"

printf 'wrote %s\n' "$receipt"
