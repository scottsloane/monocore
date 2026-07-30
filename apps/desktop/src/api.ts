// Client for the local bun backend sidecar.
const BASE = "http://localhost:8787";
const WS_BASE = "ws://localhost:8787";

export type Gb10Health = {
  reachable: boolean;
  tunnel: boolean;
  models: string[];
  error?: string;
};

export type Health = {
  backend: "ok";
  version: string;
  gb10: Gb10Health;
};

export type Job = {
  id: string;
  stage: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  createdAt: string;
  finishedAt?: string;
  exitCode?: number;
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch(`${BASE}/api/health`).then(j<Health>),
  runNoop: () =>
    fetch(`${BASE}/api/jobs/noop`, { method: "POST" }).then(j<{ jobId: string }>),
  getJob: (id: string) => fetch(`${BASE}/api/jobs/${id}`).then(j<Job>),

  // Streams log lines for a job over a websocket. Returns a close fn.
  streamLogs(id: string, onLine: (line: string) => void, onDone: (job: Job) => void) {
    const ws = new WebSocket(`${WS_BASE}/ws/jobs/${id}/logs`);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "line") onLine(msg.line);
      else if (msg.type === "done") onDone(msg.job);
    };
    return () => ws.close();
  },
};
