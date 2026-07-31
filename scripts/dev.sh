#!/usr/bin/env bash
# Run MONOCORE locally: backend sidecar + desktop app (Tauri dev).
# The backend opens the GB10 SSH tunnel itself on startup.
set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

# WebKitGTK's DMABUF renderer fails to allocate GPU buffers on some Linux
# GPU/driver/compositor combos ("Failed to create GBM buffer" → blank window).
# Fall back to the non-DMABUF path. Set MONOCORE_GPU=1 to keep GPU accel.
if [ "${MONOCORE_GPU:-0}" != "1" ]; then
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
fi

cleanup() { kill "$BACKEND_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> Starting backend (http://localhost:8787)"
( cd "$HERE/apps/backend" && bun run start ) &
BACKEND_PID=$!

sleep 1
echo "==> Starting desktop app (Tauri dev)"
cd "$HERE/apps/desktop" && bun run tauri dev
