"""Caption a project's images with the local vLLM (Qwen2.5-VL).

Reads images from <root>/input, writes an image + `.txt` caption pair per image
into <root>/dataset (the training set), where root = ~/monocore/projects/<id>.
Runs on the GB10, invoked by the job API as the `caption` stage.
"""
from __future__ import annotations

import argparse
import base64
import mimetypes
import os
import shutil
import sys

import httpx

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


def data_uri(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="project id")
    ap.add_argument("--type", default="subject")
    ap.add_argument("--trigger", default="", help="optional trigger token prefix")
    ap.add_argument("--model", default="Qwen/Qwen2.5-VL-32B-Instruct-AWQ")
    ap.add_argument("--vllm", default="http://127.0.0.1:8000")
    a = ap.parse_args()

    root = os.path.expanduser(f"~/monocore/projects/{a.project}")
    in_dir = os.path.join(root, "input")
    out_dir = os.path.join(root, "dataset")
    os.makedirs(out_dir, exist_ok=True)

    imgs = sorted(f for f in os.listdir(in_dir) if f.lower().endswith(IMAGE_EXT))
    prompt = PROMPTS.get(a.type, PROMPTS["subject"])
    print(f"[caption] {len(imgs)} image(s), type={a.type}, model={a.model}", flush=True)

    ok = 0
    with httpx.Client(timeout=180) as client:
        for i, fn in enumerate(imgs, 1):
            src = os.path.join(in_dir, fn)
            try:
                resp = client.post(
                    f"{a.vllm}/v1/chat/completions",
                    json={
                        "model": a.model,
                        "max_tokens": 200,
                        "temperature": 0.2,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": data_uri(src)},
                                    },
                                ],
                            }
                        ],
                    },
                )
                resp.raise_for_status()
                caption = resp.json()["choices"][0]["message"]["content"].strip()
            except Exception as e:  # noqa: BLE001
                print(f"[caption] {i}/{len(imgs)} {fn}: ERROR {e}", flush=True)
                continue

            if a.trigger:
                caption = f"{a.trigger}, {caption}"
            base, _ = os.path.splitext(fn)
            shutil.copyfile(src, os.path.join(out_dir, fn))
            with open(os.path.join(out_dir, base + ".txt"), "w") as f:
                f.write(caption)
            ok += 1
            print(f"[caption] {i}/{len(imgs)} {fn}: {caption[:80]}", flush=True)

    print(f"[caption] done — {ok}/{len(imgs)} captioned → {out_dir}", flush=True)
    return 0 if ok == len(imgs) else 1


if __name__ == "__main__":
    sys.exit(main())
