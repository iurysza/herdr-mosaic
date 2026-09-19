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

if [ ! -x "$HERDR_BIN_PATH" ]; then
  bash scripts/ci/install-herdr.sh "$HERDR_BIN_PATH"
fi

bun run test:herdr
python3 scripts/check-standalone.py
