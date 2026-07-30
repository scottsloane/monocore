#!/usr/bin/env bash
# Build the MONOCORE trainer image on the GB10 and sync the train/test scripts.
# Idempotent. Run once (and after Dockerfile changes).
#
#   ./scripts/gb10-install-trainer.sh
#
set -euo pipefail
GB10="${MONOCORE_GB10_HOST:-gb10}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Syncing trainer → $GB10:~/monocore/trainer"
ssh "$GB10" "mkdir -p monocore/trainer"
rsync -az --exclude '__pycache__' "$HERE/services/trainer/" "$GB10:monocore/trainer/"

echo "==> Building monocore-trainer image (this takes a while)"
ssh "$GB10" "cd monocore/trainer && docker build -t monocore-trainer:latest ."

echo "==> Verifying torch + GPU inside the image"
ssh "$GB10" "docker run --rm --gpus all monocore-trainer python -c \
  'import torch; print(\"torch\", torch.__version__, \"cuda\", torch.cuda.is_available(), torch.cuda.get_device_name(0))'"

echo "==> Done. monocore-trainer:latest ready."
