"""Caption a project's images with the local vLLM (Qwen2.5-VL).

Reads images from <root>/input, writes an image + `.txt` caption pair per image
into <root>/dataset (the training set), where root = ~/monocore/projects/<id>.
Runs on the GB10, invoked by the job API as the `caption` stage.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

import httpx

from vllm_client import ask, map_concurrent

IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".avif")

# Per training-type captioning instruction.
PROMPTS = {
    "subject": (
        "Write one concise comma-separated caption describing the main subject: "
        "what it is, its appearance, materials/colors, pose or angle, and setting. "
        "Be literal and specific. Output only the caption, no preamble."
    ),
    "person": (
        "Write one concise comma-separated caption of the person: apparent age, "
        "hair, expression, clothing, pose, and background. Literal and specific. "
        "Output only the caption."
    ),
    "face": (
        "Write one concise comma-separated caption of the face: expression, hair, "
        "distinguishing features, lighting, and angle. Output only the caption."
    ),
    "aesthetic": (
        "Write one concise comma-separated caption capturing the overall aesthetic: "
        "style, mood, color palette, composition, lighting, and medium. "
        "Output only the caption."
    ),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="project id")
    ap.add_argument("--type", default="subject")
    ap.add_argument("--trigger", default="", help="optional trigger token prefix")
    ap.add_argument(
        "--input-sub",
        default="01_deduped",
        help="work subdir to caption (latest completed ELT stage)",
    )
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--model", default="Qwen/Qwen2.5-VL-32B-Instruct-AWQ")
    ap.add_argument("--vllm", default="http://127.0.0.1:8000")
    a = ap.parse_args()

    root = os.path.expanduser(f"~/monocore/projects/{a.project}")
    in_dir = os.path.join(root, "work", a.input_sub)
    out_dir = os.path.join(root, "dataset")
    os.makedirs(out_dir, exist_ok=True)

    imgs = sorted(f for f in os.listdir(in_dir) if f.lower().endswith(IMAGE_EXT))
    prompt = PROMPTS.get(a.type, PROMPTS["subject"])
    print(f"[caption] {len(imgs)} image(s), type={a.type}, model={a.model}", flush=True)

    with httpx.Client(timeout=180) as client:
        def worker(fn):
            src = os.path.join(in_dir, fn)
            try:
                caption = ask(
                    client, prompt, src,
                    model=a.model, vllm=a.vllm, max_tokens=200, temperature=0.2,
                )
            except Exception as e:  # noqa: BLE001
                return {"file": fn, "ok": False, "text": f"ERROR {e}"}
            if a.trigger:
                caption = f"{a.trigger}, {caption}"
            base, _ = os.path.splitext(fn)
            shutil.copyfile(src, os.path.join(out_dir, fn))
            with open(os.path.join(out_dir, base + ".txt"), "w") as f:
                f.write(caption)
            return {"file": fn, "ok": True, "text": caption}

        def prog(done, total, it):
            body = it["text"][:80] if it["ok"] else it["text"]
            print(f"[caption] {done}/{total} {it['file']}: {body}", flush=True)

        results = map_concurrent(imgs, worker, a.concurrency, prog)

    ok = sum(1 for r in results if r["ok"])
    print(f"[caption] done — {ok}/{len(imgs)} captioned → {out_dir}", flush=True)
    return 0 if ok == len(imgs) else 1


if __name__ == "__main__":
    sys.exit(main())
