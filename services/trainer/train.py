"""Generate an ai-toolkit config from project params and run training.

Arch-aware (Flux / SDXL / Wan), LoRA or full fine-tune, with VRAM-tuned params
(quantize / gradient checkpointing / batch size) chosen by the backend for the
GB10's ~128GB unified memory. Runs inside the monocore-trainer container.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

import yaml


def as_bool(v: str) -> bool:
    return str(v).lower() in ("1", "true", "yes", "on")


# Per-arch model block + sampler settings. Flux keeps the verified is_flux flag;
# SDXL/Wan use ai-toolkit's `arch` field.
def model_block(arch: str, model: str, quantize: bool) -> dict:
    if arch == "flux":
        return {"name_or_path": model, "is_flux": True, "quantize": quantize}
    if arch == "sdxl":
        return {"name_or_path": model, "arch": "sdxl"}
    if arch == "wan":
        return {
            "name_or_path": model,
            "arch": "wan21",
            "quantize": True,
            "quantize_te": True,
            "low_vram": True,
        }
    raise ValueError(f"unsupported arch: {arch}")


def sampler_for(arch: str) -> tuple[str, float, int]:
    # (sampler, guidance_scale, sample_steps)
    if arch == "flux":
        return "flowmatch", 4.0, 20
    if arch == "sdxl":
        return "ddpm", 7.5, 25
    return "flowmatch", 5.0, 20


def noise_scheduler_for(arch: str) -> str:
    return "flowmatch" if arch in ("flux", "wan") else "ddpm"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--arch", default="flux", choices=["flux", "sdxl", "wan"])
    ap.add_argument("--mode", default="lora", choices=["lora", "full"])
    ap.add_argument("--model", required=True)
    ap.add_argument("--steps", type=int, default=1000)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--resolution", type=int, default=1024)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--quantize", default="false")
    ap.add_argument("--gc", default="true")  # gradient checkpointing
    ap.add_argument("--sample-every", type=int, default=0)  # 0 → only at end
    ap.add_argument("--trigger", default="")
    a = ap.parse_args()

    quantize = as_bool(a.quantize)
    gc = as_bool(a.gc)
    sample_every = a.sample_every if a.sample_every > 0 else max(a.steps, 1)

    root = f"/workspace/monocore/projects/{a.project}"
    dataset = f"{root}/dataset"
    output = f"{root}/output"
    os.makedirs(output, exist_ok=True)
    if not os.path.isdir(dataset) or not any(
        f.endswith(".txt") for f in os.listdir(dataset)
    ):
        print(f"[train] no captioned dataset at {dataset}", flush=True)
        return 2

    sampler, guidance, sample_steps = sampler_for(a.arch)
    prefix = f"{a.trigger}, " if a.trigger else ""

    process: dict = {
        "type": "sd_trainer",
        "training_folder": output,
        "device": "cuda:0",
        "save": {"dtype": "float16", "save_every": max(a.steps, 1), "max_step_saves_to_keep": 2},
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
            "batch_size": a.batch,
            "steps": a.steps,
            "gradient_accumulation_steps": 1,
            "train_unet": True,
            "train_text_encoder": False,
            "gradient_checkpointing": gc,
            "noise_scheduler": noise_scheduler_for(a.arch),
            "optimizer": "adamw",
            "lr": a.lr,
            "dtype": "bf16",
        },
        "model": model_block(a.arch, a.model, quantize),
        "sample": {
            "sampler": sampler,
            "sample_every": sample_every,
            "width": min(a.resolution, 1024),
            "height": min(a.resolution, 1024),
            "prompts": [
                f"{prefix}a professional studio photograph, sharp focus",
                f"{prefix}closeup, natural light, high detail",
            ],
            "neg": "",
            "seed": 42,
            "walk_seed": True,
            "guidance_scale": guidance,
            "sample_steps": sample_steps,
        },
    }
    # LoRA vs full fine-tune
    if a.mode == "lora":
        process["network"] = {"type": "lora", "linear": a.rank, "linear_alpha": a.rank}
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
        f"[train] arch={a.arch} mode={a.mode} steps={a.steps} rank={a.rank} "
        f"batch={a.batch} quantize={quantize} gc={gc} res={a.resolution}",
        flush=True,
    )
    print(f"[train] model={a.model}", flush=True)
    print(f"[train] config → {cfg_path}", flush=True)
    proc = subprocess.run([sys.executable, "/opt/ai-toolkit/run.py", cfg_path])
    print(f"[train] ai-toolkit exited {proc.returncode}", flush=True)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
