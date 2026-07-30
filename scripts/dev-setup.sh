#!/usr/bin/env bash
# Local dev environment setup for MONOCORE.
#   ./scripts/dev-setup.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

# bun ---------------------------------------------------------------------
if ! command -v bun >/dev/null 2>&1; then
  echo "==> Installing bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
echo "bun $(bun --version)"

# Rust / Tauri ------------------------------------------------------------
command -v cargo >/dev/null 2>&1 || {
  echo "!! Rust/cargo not found — install from https://rustup.rs"; exit 1;
}

# Linux system deps for Tauri (webkit2gtk). Best-effort hint only.
if [ "$(uname)" = "Linux" ] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  echo "!! webkit2gtk-4.1 not found. On Debian/Ubuntu:"
  echo "   sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev \\"
  echo "        libayatana-appindicator3-dev librsvg2-dev file"
fi

# Install JS deps ---------------------------------------------------------
echo "==> Installing desktop deps"
( cd "$HERE/apps/desktop" && bun install )
echo "==> Installing backend deps"
( cd "$HERE/apps/backend" && bun install )

echo "==> Done. Next:"
echo "   ./scripts/gb10-setup.sh        # deploy job API to the GB10"
echo "   ./scripts/dev.sh               # run backend + desktop app"
