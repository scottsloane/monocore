#!/usr/bin/env bash
# Run MONOCORE locally: backend sidecar + desktop app (Tauri dev).
# The backend opens the GB10 SSH tunnel itself on startup.
set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() { kill "$BACKEND_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> Starting backend (http://localhost:8787)"
( cd "$HERE/apps/backend" && bun run start ) &
BACKEND_PID=$!

sleep 1
echo "==> Starting desktop app (Tauri dev)"
cd "$HERE/apps/desktop" && bun run tauri dev
