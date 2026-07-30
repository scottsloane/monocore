"""Test generation with the trained LoRA (arch-aware via diffusers AutoPipeline).

Loads the base model + the project's freshly trained LoRA and writes sample images
to .../output/test. Works for Flux and SDXL (AutoPipeline picks the class).
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

import torch
from diffusers import AutoPipelineForText2Image


def newest_lora(output_dir: str) -> str | None:
    files = glob.glob(os.path.join(output_dir, "**", "*.safetensors"), recursive=True)
    return max(files, key=os.path.getmtime) if files else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--arch", default="flux", choices=["flux", "sdxl"])
    ap.add_argument("--model", default="black-forest-labs/FLUX.1-dev")
    ap.add_argument("--n", type=int, default=2)
    ap.add_argument("--steps", type=int, default=0)
    ap.add_argument("--guidance", type=float, default=0)
    a = ap.parse_args()

    steps = a.steps or (24 if a.arch == "flux" else 28)
    guidance = a.guidance or (3.5 if a.arch == "flux" else 7.0)

    root = f"/workspace/monocore/projects/{a.project}"
    output = f"{root}/output"
    test_dir = f"{output}/test"
    os.makedirs(test_dir, exist_ok=True)

    lora = newest_lora(output)
    print(f"[test] arch={a.arch} lora={lora or 'NONE (base only)'}", flush=True)
    print(f"[test] loading {a.model} …", flush=True)
    pipe = AutoPipelineForText2Image.from_pretrained(a.model, torch_dtype=torch.bfloat16)
    pipe = pipe.to("cuda")
    if lora:
        pipe.load_lora_weights(lora)

    for i in range(a.n):
        print(f"[test] generating {i + 1}/{a.n} …", flush=True)
        img = pipe(
            a.prompt,
            num_inference_steps=steps,
            guidance_scale=guidance,
            generator=torch.Generator("cuda").manual_seed(1000 + i),
        ).images[0]
        path = os.path.join(test_dir, f"test_{i}.png")
        img.save(path)
        print(f"[test] saved {path}", flush=True)

    print(f"[test] done → {test_dir}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
