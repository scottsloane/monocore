"""Job registry with a FIFO worker (one job at a time) and live log fan-out.

GPU work (train/test) and vLLM work (caption/ELT) are serialized through a single
queue so they never contend for the GB10. Jobs start `queued`, then `running`.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from stages import build_command, container_name

CONTAINER_STAGES = {"train", "test"}
MAX_LINES = 5000  # per-job retained log lines (rolling)


@dataclass
class Job:
    id: str
    stage: str
    params: dict
    cmd: list[str]
    status: str = "queued"  # queued | running | succeeded | failed | canceled
    exit_code: int | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    lines: list[str] = field(default_factory=list)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    done: asyncio.Event = field(default_factory=asyncio.Event)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    _proc: asyncio.subprocess.Process | None = None

    def summary(self) -> dict:
        return {
            "id": self.id,
            "stage": self.stage,
            "status": self.status,
            "exit_code": self.exit_code,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker: asyncio.Task | None = None

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def list(self) -> list[dict]:
        return [j.summary() for j in self._jobs.values()]

    def create(self, stage: str, params: dict) -> Job:
        job_id = uuid.uuid4().hex[:12]
        cmd = build_command(stage, params, job_id)  # validates stage/params
        job = Job(id=job_id, stage=stage, params=params, cmd=cmd)
        self._jobs[job_id] = job
        self._queue.put_nowait(job_id)
        if self._worker is None:
            self._worker = asyncio.create_task(self._run_worker())
        pos = self._queue.qsize()
        asyncio.create_task(
            self._emit(job, f"[gb10] queued (position {pos})")
        )
        return job

    async def _run_worker(self) -> None:
        while True:
            job_id = await self._queue.get()
            job = self._jobs.get(job_id)
            if job is None or job.status == "canceled":
                continue
            await self._run(job)

    async def _emit(self, job: Job, line: str) -> None:
        async with job.lock:
            job.lines.append(line)
            # bound retained history (long trainings emit thousands of progress
            # lines) so memory / replay stays sane
            if len(job.lines) > MAX_LINES:
                del job.lines[: len(job.lines) - MAX_LINES]
            for q in job.subscribers:
                q.put_nowait(("line", line))

    async def _run(self, job: Job) -> None:
        job.status = "running"
        await self._emit(job, "[gb10] running")
        try:
            proc = await asyncio.create_subprocess_exec(
                *job.cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            job._proc = proc
            assert proc.stdout is not None
            # Read raw chunks rather than readline(): tqdm progress bars update
            # with '\r' and emit no '\n' for thousands of updates, which overruns
            # StreamReader's 64KB line limit ("Separator is not found…"). Draining
            # in chunks and treating CR as a line break avoids the crash (and the
            # pipe never fills), turning each progress tick into its own log line.
            buf = b""
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                buf += chunk.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    await self._emit(job, line.decode(errors="replace"))
            if buf:
                await self._emit(job, buf.decode(errors="replace"))
            rc = await proc.wait()
            job.exit_code = rc
            if job.status != "canceled":
                job.status = "succeeded" if rc == 0 else "failed"
        except Exception as e:  # noqa: BLE001
            await self._emit(job, f"[gb10] runner error: {e}")
            job.status = "failed"
            job.exit_code = -1
        finally:
            job.finished_at = time.time()
            job.done.set()
            async with job.lock:
                for q in job.subscribers:
                    q.put_nowait(("done", None))
                job.subscribers.clear()

    async def cancel(self, job: Job) -> None:
        if job.status == "queued":
            job.status = "canceled"
            job.finished_at = time.time()
            job.done.set()
            async with job.lock:
                for q in job.subscribers:
                    q.put_nowait(("done", None))
                job.subscribers.clear()
            return
        if job.status != "running":
            return
        job.status = "canceled"
        # Containerized jobs may detach from `docker run`; kill by name too.
        if job.stage in CONTAINER_STAGES:
            try:
                p = await asyncio.create_subprocess_exec(
                    "docker", "kill", container_name(job.id),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await p.wait()
            except Exception:  # noqa: BLE001
                pass
        if job._proc:
            job._proc.terminate()

    async def subscribe(self, job: Job) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        async with job.lock:
            for line in job.lines:
                q.put_nowait(("line", line))
            if job.done.is_set():
                q.put_nowait(("done", None))
            else:
                job.subscribers.add(q)
        return q

    def unsubscribe(self, job: Job, q: asyncio.Queue) -> None:
        job.subscribers.discard(q)


manager = JobManager()
