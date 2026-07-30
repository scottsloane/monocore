"""vLLM-driven ELT stages: quality, subject, crop.

Runs on the GB10 (gb10-api venv). Operates on a project's work dirs:
  ~/monocore/projects/<id>/work/<in>  →  .../work/<out>
Each stage copies the images it keeps into <out> (so the next stage reads only
those) and writes <out>/manifest.json describing every evaluated image. Quality
and Subject preserve filenames (so the UI can show them from the local deduped
set); Crop writes new cropped images (pulled back for review).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

import httpx
from PIL import Image

from vllm_client import ask, extract_json, DEFAULT_MODEL

IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".avif")


def list_images(d: str) -> list[str]:
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d) if f.lower().endswith(IMAGE_EXT))


# ---- quality -------------------------------------------------------------
def stage_quality(client, in_dir, out_dir, imgs, args) -> list[dict]:
    prompt = (
        "You are grading an image for a model-training dataset. Rate its technical "
        "quality from 0 to 10 (sharpness/focus, exposure, noise/compression artifacts, "
        "and composition). Respond ONLY with JSON: "
        '{"score": <number 0-10>, "reason": "<short>"}'
    )
    items = []
    for i, fn in enumerate(imgs, 1):
        src = os.path.join(in_dir, fn)
        try:
            data = extract_json(ask(client, prompt, src, model=args.model, json_mode=True))
            score = float(data.get("score", 0))
            reason = str(data.get("reason", ""))[:200]
        except Exception as e:  # noqa: BLE001
            score, reason = 0.0, f"error: {e}"
        keep = score >= args.threshold
        if keep:
            shutil.copyfile(src, os.path.join(out_dir, fn))
        items.append({"file": fn, "score": round(score, 1), "keep": keep, "reason": reason})
        print(f"[quality] {i}/{len(imgs)} {fn}: {score:.1f} {'keep' if keep else 'drop'}", flush=True)
    return items


# ---- subject / aesthetic -------------------------------------------------
def stage_subject(client, in_dir, out_dir, imgs, args) -> list[dict]:
    subject = (args.subject or "").strip()
    if not subject:
        # nothing to match against — pass everything through
        for fn in imgs:
            shutil.copyfile(os.path.join(in_dir, fn), os.path.join(out_dir, fn))
        print("[subject] no subject description — keeping all", flush=True)
        return [{"file": fn, "match": True, "keep": True, "reason": "no subject set"} for fn in imgs]

    noun = "aesthetic" if args.type == "aesthetic" else "subject"
    prompt = (
        f"The target {noun} for this dataset is: \"{subject}\". "
        f"Does this image clearly depict that {noun}? Respond ONLY with JSON: "
        '{"match": true|false, "reason": "<short>"}'
    )
    items = []
    for i, fn in enumerate(imgs, 1):
        src = os.path.join(in_dir, fn)
        try:
            data = extract_json(ask(client, prompt, src, model=args.model, json_mode=True))
            match = bool(data.get("match", False))
            reason = str(data.get("reason", ""))[:200]
        except Exception as e:  # noqa: BLE001
            match, reason = False, f"error: {e}"
        if match:
            shutil.copyfile(src, os.path.join(out_dir, fn))
        items.append({"file": fn, "match": match, "keep": match, "reason": reason})
        print(f"[subject] {i}/{len(imgs)} {fn}: {'match' if match else 'no'}", flush=True)
    return items


# ---- crop ----------------------------------------------------------------
def stage_crop(client, in_dir, out_dir, imgs, args) -> list[dict]:
    subject = (args.subject or "the main subject").strip() or "the main subject"
    prompt = (
        f"Return a tight bounding box around {subject} in this image as JSON: "
        '{"box": [x0, y0, x1, y1]} using normalized coordinates in [0,1] with '
        "x0<x1 and y0<y1. If the subject already fills most of the frame, return "
        '{"box": [0, 0, 1, 1]}.'
    )
    items = []
    for i, fn in enumerate(imgs, 1):
        src = os.path.join(in_dir, fn)
        item = {"file": fn, "keep": True}
        try:
            im = Image.open(src).convert("RGB")
            w, h = im.size
            box = extract_json(ask(client, prompt, src, model=args.model, json_mode=True)).get("box")
            x0, y0, x1, y1 = (float(v) for v in box)
            x0, x1 = sorted((max(0.0, min(1.0, x0)), max(0.0, min(1.0, x1))))
            y0, y1 = sorted((max(0.0, min(1.0, y0)), max(0.0, min(1.0, y1))))
            # pad around the box, clamped to the frame
            pad = args.pad
            bw, bh = x1 - x0, y1 - y0
            x0 = max(0.0, x0 - bw * pad); x1 = min(1.0, x1 + bw * pad)
            y0 = max(0.0, y0 - bh * pad); y1 = min(1.0, y1 + bh * pad)
            px0, py0, px1, py1 = int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
            near_full = (px1 - px0) >= 0.95 * w and (py1 - py0) >= 0.95 * h
            too_small = (px1 - px0) < args.min_side or (py1 - py0) < args.min_side
            if near_full or too_small:
                out = im
                item.update(cropped=False, box=[0, 0, 1, 1],
                            reason="full-frame" if near_full else "box too small")
            else:
                out = im.crop((px0, py0, px1, py1))
                item.update(cropped=True, box=[round(x0, 3), round(y0, 3), round(x1, 3), round(y1, 3)])
            out.save(os.path.join(out_dir, fn))
        except Exception as e:  # noqa: BLE001
            shutil.copyfile(src, os.path.join(out_dir, fn))
            item.update(cropped=False, reason=f"error: {e}")
        items.append(item)
        print(f"[crop] {i}/{len(imgs)} {fn}: {'cropped' if item.get('cropped') else 'kept'}", flush=True)
    return items


STAGES = {"quality": stage_quality, "subject": stage_subject, "crop": stage_crop}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=list(STAGES))
    ap.add_argument("--project", required=True)
    ap.add_argument("--in", dest="in_sub", required=True)
    ap.add_argument("--out", dest="out_sub", required=True)
    ap.add_argument("--subject", default="")
    ap.add_argument("--type", default="subject")
    ap.add_argument("--threshold", type=float, default=5.0)
    ap.add_argument("--pad", type=float, default=0.12)
    ap.add_argument("--min-side", type=int, default=512)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args()

    work = os.path.expanduser(f"~/monocore/projects/{args.project}/work")
    in_dir = os.path.join(work, args.in_sub)
    out_dir = os.path.join(work, args.out_sub)
    os.makedirs(out_dir, exist_ok=True)
    # clear stale outputs so re-runs are clean
    for f in os.listdir(out_dir):
        fp = os.path.join(out_dir, f)
        if os.path.isfile(fp):
            os.remove(fp)

    imgs = list_images(in_dir)
    print(f"[{args.stage}] {len(imgs)} image(s) from {args.in_sub} → {args.out_sub}", flush=True)

    with httpx.Client(timeout=180) as client:
        items = STAGES[args.stage](client, in_dir, out_dir, imgs, args)

    kept = sum(1 for it in items if it.get("keep", True))
    manifest = {"stage": args.stage, "total": len(items), "kept": kept, "items": items}
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[{args.stage}] done — {kept}/{len(items)} kept → {out_dir}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
