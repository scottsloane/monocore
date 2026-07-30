"""In-process job registry and subprocess runner with live log fan-out."""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from stages import build_command


@dataclass
class Job:
    id: str
    stage: str
    params: dict
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

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def list(self) -> list[dict]:
        return [j.summary() for j in self._jobs.values()]

    def create(self, stage: str, params: dict) -> Job:
        # Raises ValueError for unknown stages before we register the job.
        cmd = build_command(stage, params)
        job = Job(id=uuid.uuid4().hex[:12], stage=stage, params=params)
        self._jobs[job.id] = job
        asyncio.create_task(self._run(job, cmd))
        return job

    async def _emit(self, job: Job, line: str) -> None:
        async with job.lock:
            job.lines.append(line)
            for q in job.subscribers:
                q.put_nowait(("line", line))

    async def _run(self, job: Job, cmd: list[str]) -> None:
        job.status = "running"
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            job._proc = proc
            assert proc.stdout is not None
            async for raw in proc.stdout:
                await self._emit(job, raw.decode(errors="replace").rstrip("\n"))
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
        if job._proc and job.status == "running":
            job.status = "canceled"
            job._proc.terminate()

    async def subscribe(self, job: Job) -> asyncio.Queue:
        """Return a queue primed with backlog then fed live events.

        Held under the job lock so no line slips between replay and registration.
        """
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
