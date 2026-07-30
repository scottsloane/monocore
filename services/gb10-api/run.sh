#!/usr/bin/env bash
# Run the GB10 job API from its venv (foreground). Binds localhost only.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${MONOCORE_GB10_PORT:-8788}"
exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port "$PORT"
