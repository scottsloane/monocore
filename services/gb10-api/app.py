"""MONOCORE GB10 job API.

FastAPI service that runs ELT/training/generation stages as tracked subprocesses
and streams their logs. Binds localhost only; reached via an SSH tunnel from the
local orchestrator. See docs/ARCHITECTURE.md.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from jobs import manager

VERSION = "0.1.0"
VLLM_URL = os.environ.get("MONOCORE_VLLM_URL", "http://127.0.0.1:8000")

app = FastAPI(title="MONOCORE GB10 API", version=VERSION)


async def vllm_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{VLLM_URL}/v1/models")
            r.raise_for_status()
            return [m["id"] for m in r.json().get("data", [])]
    except Exception:
        return []


def gpu_info() -> str | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        return out.splitlines()[0] if out else None
    except Exception:  # noqa: BLE001
        return None


@app.get("/health")
async def health() -> dict:
    try:
        _, _, free = shutil.disk_usage(os.path.expanduser("~/monocore"))
        disk_free_gb = round(free / 1e9, 1)
    except Exception:  # noqa: BLE001
        disk_free_gb = None
    return {
        "status": "ok",
        "version": VERSION,
        "models": await vllm_models(),
        "disk_free_gb": disk_free_gb,
        "gpu": gpu_info(),
    }


@app.get("/models")
async def models() -> dict:
    return {"models": await vllm_models()}


class CreateJob(BaseModel):
    stage: str
    params: dict = {}


@app.post("/jobs")
async def create_job(body: CreateJob) -> dict:
    try:
        job = manager.create(body.stage, body.params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return job.summary()


@app.get("/jobs")
async def list_jobs() -> dict:
    return {"jobs": manager.list()}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    job = manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job.summary()


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str) -> dict:
    job = manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    await manager.cancel(job)
    return job.summary()


@app.get("/elt/manifest")
async def elt_manifest(project: str, out_sub: str) -> dict:
    path = os.path.expanduser(
        f"~/monocore/projects/{project}/work/{out_sub}/manifest.json"
    )
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="manifest not found")
    with open(path) as f:
        return json.load(f)


class Override(BaseModel):
    project: str
    in_sub: str
    out_sub: str
    file: str
    keep: bool


@app.post("/elt/override")
async def elt_override(body: Override) -> dict:
    """Manually accept/reject a file in an ELT stage: update the manifest keep flag
    and add/remove the file from the stage output dir so downstream stages honor it.
    """
    work = os.path.expanduser(f"~/monocore/projects/{body.project}/work")
    out_dir = os.path.join(work, body.out_sub)
    manifest_path = os.path.join(out_dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail="manifest not found")

    with open(manifest_path) as f:
        manifest = json.load(f)

    found = False
    for item in manifest["items"]:
        if item["file"] == body.file:
            item["keep"] = body.keep
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="file not in manifest")

    dst = os.path.join(out_dir, body.file)
    if body.keep:
        src = os.path.join(work, body.in_sub, body.file)
        if os.path.isfile(src):
            shutil.copyfile(src, dst)
    elif os.path.isfile(dst):
        os.remove(dst)

    manifest["kept"] = sum(1 for it in manifest["items"] if it.get("keep", True))
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    return manifest


@app.get("/jobs/{job_id}/logs")
async def job_logs(job_id: str, request: Request) -> StreamingResponse:
    job = manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    async def gen():
        q = await manager.subscribe(job)
        try:
            while True:
                if await request.is_disconnected():
                    break
                kind, payload = await q.get()
                if kind == "line":
                    yield f"data: {json.dumps({'line': payload})}\n\n"
                else:
                    yield f"data: {json.dumps({'done': True, 'job': job.summary()})}\n\n"
                    break
        finally:
            manager.unsubscribe(job, q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
