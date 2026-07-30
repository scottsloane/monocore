"""MONOCORE GB10 job API.

FastAPI service that runs ELT/training/generation stages as tracked subprocesses
and streams their logs. Binds localhost only; reached via an SSH tunnel from the
local orchestrator. See docs/ARCHITECTURE.md.
"""
from __future__ import annotations

import json
import os

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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": VERSION, "models": await vllm_models()}


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
