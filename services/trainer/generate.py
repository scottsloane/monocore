"""Test generation with the trained LoRA (diffusers FluxPipeline).

Runs inside the monocore-trainer container. Loads FLUX.1-dev + the project's
freshly trained LoRA and writes sample images to .../output/test.
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

import torch
from diffusers import FluxPipeline


def newest_lora(output_dir: str) -> str | None:
    files = glob.glob(os.path.join(output_dir, "**", "*.safetensors"), recursive=True)
    return max(files, key=os.path.getmtime) if files else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--n", type=int, default=2)
    ap.add_argument("--steps", type=int, default=24)
    ap.add_argument("--guidance", type=float, default=3.5)
    ap.add_argument("--model", default="black-forest-labs/FLUX.1-dev")
    a = ap.parse_args()

    root = f"/workspace/monocore/projects/{a.project}"
    output = f"{root}/output"
    test_dir = f"{output}/test"
    os.makedirs(test_dir, exist_ok=True)

    lora = newest_lora(output)
    print(f"[test] lora: {lora or 'NONE (base model only)'}", flush=True)

    print(f"[test] loading {a.model} …", flush=True)
    pipe = FluxPipeline.from_pretrained(a.model, torch_dtype=torch.bfloat16)
    pipe = pipe.to("cuda")
    if lora:
        pipe.load_lora_weights(lora)

    for i in range(a.n):
        print(f"[test] generating {i + 1}/{a.n} …", flush=True)
        img = pipe(
            a.prompt,
            num_inference_steps=a.steps,
            guidance_scale=a.guidance,
            generator=torch.Generator("cuda").manual_seed(1000 + i),
        ).images[0]
        path = os.path.join(test_dir, f"test_{i}.png")
        img.save(path)
        print(f"[test] saved {path}", flush=True)

    print(f"[test] done → {test_dir}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
