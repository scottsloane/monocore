"""Maps an ELT/training stage name to the command that runs it on the GB10.

M0 only implements `noop` (connectivity check). Later milestones add: prune,
dedupe, quality, subject, crop, caption, train, test.
"""
from __future__ import annotations


def build_command(stage: str, params: dict) -> list[str]:
    if stage == "noop":
        script = (
            'echo "[gb10] hello from $(hostname) ($(uname -m))"; '
            'echo "[gb10] date $(date -u +%FT%TZ)"; '
            'if command -v nvidia-smi >/dev/null 2>&1; then '
            '  nvidia-smi --query-gpu=name,memory.used,memory.total '
            '    --format=csv,noheader | sed "s/^/[gb10] gpu: /"; '
            'else echo "[gb10] nvidia-smi not found"; fi; '
            'for i in 1 2 3; do echo "[gb10] tick $i/3"; sleep 0.3; done; '
            'echo "[gb10] noop complete"'
        )
        return ["bash", "-lc", script]

    raise ValueError(f"unknown stage: {stage}")
