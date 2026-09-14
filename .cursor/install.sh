#!/usr/bin/env bash
# Cloud Agent bootstrap for the multi-repo workspace anchored on herdr-mosaic.
#
# Idempotent and non-interactive: safe to re-run. Installs the pinned toolchains
# and per-repo dependencies for every repository in /agent/repos:
#
#   clockwork                  Rust 1.85.0 (rustfmt, clippy)
#   herdr-mosaic               Python 3.6+ stdlib + Herdr CLI 0.9.0
#   termscope                  Python 3.6+ stdlib + Herdr CLI 0.9.0
#   herdr-tab-smart-rename     Bun 1.1.34
#   pi-extensions              Node 22.22.3 + npm
#   visual-artifact-renderer   Node 22.22.3 + Bun 1.1.34 + pnpm 11.5.2 + ast-grep 0.43.0
#
# Toolchain versions are pinned to each repo's CI (see their .github/workflows).
set -euo pipefail

REPOS=/agent/repos

log() { printf '\n=== %s ===\n' "$*"; }

# --- Herdr CLI 0.9.0 (herdr-mosaic tests + herdr config check; termscope host) ---
# Reuses herdr-mosaic's pinned installer (single source of truth for version+sha).
# ctx.herdr_bin() defaults to ~/.local/bin/herdr; the /usr/local/bin symlink lets
# `which herdr` / shutil.which("herdr") resolve it without PATH changes.
log "Herdr CLI 0.9.0"
bash "$REPOS/herdr-mosaic/scripts/ci/install-herdr.sh" "$HOME/.local/bin/herdr"
sudo ln -sf "$HOME/.local/bin/herdr" /usr/local/bin/herdr

# --- Rust 1.85.0 + rustfmt + clippy (clockwork) ---
# clockwork/rust-toolchain.toml pins channel 1.85.0; rustup auto-selects it there.
log "Rust 1.85.0"
rustup toolchain install 1.85.0 --profile minimal --component rustfmt --component clippy

# --- Node 22.22.3 + pnpm 11.5.2 (pi-extensions, visual-artifact-renderer) ---
# visual-artifact-renderer/scripts/verify.sh requires exactly node v22.22.3;
# pi-extensions requires node >=22.19.0. 22.22.3 satisfies both.
log "Node 22.22.3 + pnpm 11.5.2"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 22.22.3
nvm alias default 22.22.3
nvm use 22.22.3
corepack enable
corepack prepare pnpm@11.5.2 --activate
export PATH="$NVM_DIR/versions/node/v22.22.3/bin:$PATH"
hash -r

# --- Bun 1.1.34 (herdr-tab-smart-rename, visual-artifact-renderer) ---
log "Bun 1.1.34"
if [ "$("$HOME/.bun/bin/bun" --version 2>/dev/null || true)" != "1.1.34" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.1.34"
fi
sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bunx
export PATH="$HOME/.bun/bin:$PATH"
hash -r

# --- ast-grep 0.43.0 (visual-artifact-renderer verify gate) ---
log "ast-grep 0.43.0"
npm install --global @ast-grep/cli@0.43.0

# --- Per-repo dependency installs ---
log "clockwork: cargo fetch"
( cd "$REPOS/clockwork" && cargo fetch --locked )

log "herdr-tab-smart-rename: bun install"
( cd "$REPOS/herdr-tab-smart-rename" && bun install --frozen-lockfile )

log "pi-extensions: npm ci"
( cd "$REPOS/pi-extensions" && npm ci )

log "visual-artifact-renderer: bun + pnpm installs"
for d in shared cli worker; do
  ( cd "$REPOS/visual-artifact-renderer/$d" && bun install --frozen-lockfile )
done
( cd "$REPOS/visual-artifact-renderer/app" && pnpm install --frozen-lockfile )

# termscope: Python 3.6+ stdlib only (uses tomllib on 3.11+); nothing to install.

log "Bootstrap complete"
herdr --version
rustup run 1.85.0 rustc --version
node --version
pnpm --version
bun --version
ast-grep --version
