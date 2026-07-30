"""Maps an ELT/training stage name to the command that runs it on the GB10.

Implemented: `noop` (connectivity), `caption` (vLLM). Later: quality, subject,
crop, train, test. Commands are arg lists (no shell) so params can't inject.
"""
from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))


def build_command(stage: str, params: dict) -> list[str]:
    if stage == "caption":
        if "project" not in params:
            raise ValueError("caption stage requires params.project")
        cmd = [
            sys.executable,
            os.path.join(_HERE, "caption.py"),
            "--project",
            str(params["project"]),
            "--type",
            str(params.get("type", "subject")),
        ]
        if params.get("trigger"):
            cmd += ["--trigger", str(params["trigger"])]
        if params.get("model"):
            cmd += ["--model", str(params["model"])]
        return cmd

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
