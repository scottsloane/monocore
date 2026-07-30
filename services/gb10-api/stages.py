"""Maps an ELT/training stage name to the command that runs it on the GB10.

Implemented: `noop` (connectivity), `caption` (vLLM). Later: quality, subject,
crop, train, test. Commands are arg lists (no shell) so params can't inject.
"""
from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_HOME = os.path.expanduser("~")

# Common `docker run` prefix for GPU stages using the trainer image.
_TRAINER_DOCKER = [
    "docker", "run", "--rm", "--gpus", "all", "--ipc=host",
    "--ulimit", "memlock=-1", "--ulimit", "stack=67108864",
    "-v", f"{_HOME}/.cache/huggingface:/root/.cache/huggingface",
    "-v", f"{_HOME}/monocore:/workspace/monocore",
    "monocore-trainer:latest",
]


def build_command(stage: str, params: dict) -> list[str]:
    if stage == "train":
        if "project" not in params:
            raise ValueError("train stage requires params.project")
        cmd = _TRAINER_DOCKER + [
            "python", "/workspace/monocore/trainer/train.py",
            "--project", str(params["project"]),
            "--steps", str(params.get("steps", 1000)),
            "--rank", str(params.get("rank", 16)),
            "--lr", str(params.get("lr", 1e-4)),
            "--resolution", str(params.get("resolution", 1024)),
        ]
        if params.get("trigger"):
            cmd += ["--trigger", str(params["trigger"])]
        return cmd

    if stage == "test":
        if "project" not in params:
            raise ValueError("test stage requires params.project")
        return _TRAINER_DOCKER + [
            "python", "/workspace/monocore/trainer/generate.py",
            "--project", str(params["project"]),
            "--prompt", str(params.get("prompt", "a professional photograph")),
            "--n", str(params.get("n", 2)),
        ]

    if stage in ("quality", "subject", "crop"):
        if "project" not in params or "in" not in params or "out" not in params:
            raise ValueError(f"{stage} stage requires params.project/in/out")
        cmd = [
            sys.executable, os.path.join(_HERE, "elt.py"),
            "--stage", stage,
            "--project", str(params["project"]),
            "--in", str(params["in"]),
            "--out", str(params["out"]),
        ]
        if params.get("subject"):
            cmd += ["--subject", str(params["subject"])]
        if params.get("type"):
            cmd += ["--type", str(params["type"])]
        if params.get("threshold") is not None:
            cmd += ["--threshold", str(params["threshold"])]
        if params.get("pad") is not None:
            cmd += ["--pad", str(params["pad"])]
        if params.get("min_side") is not None:
            cmd += ["--min-side", str(params["min_side"])]
        return cmd

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
        if params.get("input_sub"):
            cmd += ["--input-sub", str(params["input_sub"])]
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
