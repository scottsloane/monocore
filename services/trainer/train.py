"""Generate an ai-toolkit config from project params and run a Flux LoRA train.

Runs inside the monocore-trainer container. Reads the captioned dataset at
/workspace/monocore/projects/<id>/dataset and writes the LoRA + samples to
.../output. Streams ai-toolkit's stdout (progress) to the caller.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

import yaml


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--steps", type=int, default=1000)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--resolution", type=int, default=1024)
    ap.add_argument("--trigger", default="")
    ap.add_argument("--model", default="black-forest-labs/FLUX.1-dev")
    a = ap.parse_args()

    root = f"/workspace/monocore/projects/{a.project}"
    dataset = f"{root}/dataset"
    output = f"{root}/output"
    os.makedirs(output, exist_ok=True)

    if not os.path.isdir(dataset) or not any(
        f.endswith(".txt") for f in os.listdir(dataset)
    ):
        print(f"[train] no captioned dataset at {dataset}", flush=True)
        return 2

    sample_prefix = f"{a.trigger}, " if a.trigger else ""
    process = {
        "type": "sd_trainer",
        "training_folder": output,
        "device": "cuda:0",
        "network": {"type": "lora", "linear": a.rank, "linear_alpha": a.rank},
        "save": {
            "dtype": "float16",
            "save_every": max(a.steps, 1),
            "max_step_saves_to_keep": 2,
        },
        "datasets": [
            {
                "folder_path": dataset,
                "caption_ext": "txt",
                "caption_dropout_rate": 0.05,
                "cache_latents_to_disk": True,
                "resolution": [a.resolution],
            }
        ],
        "train": {
            "batch_size": 1,
            "steps": a.steps,
            "gradient_accumulation_steps": 1,
            "train_unet": True,
            "train_text_encoder": False,
            "gradient_checkpointing": True,
            "noise_scheduler": "flowmatch",
            "optimizer": "adamw",
            "lr": a.lr,
            "dtype": "bf16",
        },
        "model": {"name_or_path": a.model, "is_flux": True, "quantize": True},
        "sample": {
            "sampler": "flowmatch",
            "sample_every": max(a.steps, 1),
            "width": 1024,
            "height": 1024,
            "prompts": [
                f"{sample_prefix}a professional studio photograph, sharp focus",
                f"{sample_prefix}closeup, natural light, high detail",
            ],
            "neg": "",
            "seed": 42,
            "walk_seed": True,
            "guidance_scale": 4,
            "sample_steps": 20,
        },
    }
    if a.trigger:
        process["trigger_word"] = a.trigger

    config = {
        "job": "extension",
        "config": {"name": a.project, "process": [process]},
        "meta": {"name": a.project, "version": "1.0"},
    }

    cfg_path = f"{root}/train_config.yaml"
    with open(cfg_path, "w") as f:
        yaml.safe_dump(config, f, sort_keys=False)

    print(
        f"[train] {a.steps} steps · rank {a.rank} · lr {a.lr} · res {a.resolution}"
        f" · model {a.model}",
        flush=True,
    )
    print(f"[train] config → {cfg_path}", flush=True)
    proc = subprocess.run([sys.executable, "/opt/ai-toolkit/run.py", cfg_path])
    print(f"[train] ai-toolkit exited {proc.returncode}", flush=True)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
