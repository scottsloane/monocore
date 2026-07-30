#!/usr/bin/env bash
# Deploy + (re)start the MONOCORE job API on the GB10.
#
# Runs locally, drives the GB10 over `ssh`. Idempotent. Only touches ~/monocore
# on the remote (per project constraints).
#
#   ./scripts/gb10-setup.sh            # deploy, install deps, restart, verify
#
set -euo pipefail

GB10="${MONOCORE_GB10_HOST:-gb10}"
PORT="${MONOCORE_GB10_PORT:-8788}"
REMOTE_ROOT="\$HOME/monocore"
REMOTE_API="$REMOTE_ROOT/gb10-api"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Ensuring remote directories on $GB10"
ssh "$GB10" "mkdir -p $REMOTE_ROOT/gb10-api $REMOTE_ROOT/projects"

echo "==> Syncing gb10-api → $GB10:$REMOTE_API"
rsync -az --delete \
  --exclude '.venv' --exclude '__pycache__' \
  "$HERE/services/gb10-api/" "$GB10:monocore/gb10-api/"

echo "==> Creating venv + installing deps (first run only)"
ssh "$GB10" bash -s <<'REMOTE'
set -euo pipefail
cd "$HOME/monocore/gb10-api"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r requirements.txt
REMOTE

echo "==> Restarting job API on 127.0.0.1:$PORT"
ssh "$GB10" bash -s <<REMOTE
set -euo pipefail
cd "\$HOME/monocore/gb10-api"
# stop any previous instance
pkill -f "uvicorn app:app --host 127.0.0.1 --port $PORT" 2>/dev/null || true
sleep 1
MONOCORE_GB10_PORT=$PORT nohup ./.venv/bin/python -m uvicorn app:app \
  --host 127.0.0.1 --port $PORT > "\$HOME/monocore/gb10-api/api.log" 2>&1 &
sleep 2
REMOTE

echo "==> Verifying /health"
ssh "$GB10" "curl -fsS http://127.0.0.1:$PORT/health" && echo
echo "==> Done. Tail logs with: ssh $GB10 'tail -f monocore/gb10-api/api.log'"
