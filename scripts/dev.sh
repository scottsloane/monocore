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

# Clear any stale MONOCORE backend / orphaned SSH tunnel left by a previous run
# (e.g. a hard-killed session) so the port bind never conflicts.
echo "==> Clearing any stale backend / tunnel"
pkill -f "bun run src/index.ts" 2>/dev/null || true
pkill -f "8788:127.0.0.1:8788" 2>/dev/null || true
for _ in 1 2 3 4 5; do
  ss -ltn 2>/dev/null | grep -qE ':8787|:8788' || break
  sleep 0.3
done

cleanup() { kill "$BACKEND_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> Starting backend (http://localhost:8787)"
( cd "$HERE/apps/backend" && bun run start ) &
BACKEND_PID=$!

sleep 1
echo "==> Starting desktop app (Tauri dev)"
cd "$HERE/apps/desktop" && bun run tauri dev
