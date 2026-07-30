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

export type BaseModel = "flux" | "sdxl" | "wan";
export type TrainType = "subject" | "aesthetic" | "person" | "face";

export type Settings = {
  resolution: number;
  minDim: number;
  dedupeThreshold: number;
  steps: number;
  learningRate: number;
  rank: number;
};

export type PruneResult = {
  total: number;
  kept: number;
  pruned: number;
  minDim: number;
};
export type DedupeResult = {
  total: number;
  kept: number;
  removed: number;
  threshold: number;
};

export type Project = {
  id: string;
  name: string;
  baseModel: BaseModel;
  trainType: TrainType;
  status: string;
  settings: Settings;
  source: { inputFolder: string; imageCount: number };
  stages: {
    prune?: PruneResult;
    dedupe?: DedupeResult;
    caption?: { captioned?: number };
    [k: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreateInput = {
  name: string;
  baseModel: BaseModel;
  trainType: TrainType;
  inputFolder: string;
};

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch(`${BASE}/api/health`).then(j<Health>),

  listProjects: () =>
    fetch(`${BASE}/api/projects`).then(j<{ projects: Project[] }>),
  getProject: (id: string) =>
    fetch(`${BASE}/api/projects/${id}`).then(j<Project>),
  createProject: (input: CreateInput) =>
    fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<Project>),

  runPrune: (id: string, minDim?: number) =>
    fetch(`${BASE}/api/projects/${id}/prune`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(minDim ? { minDim } : {}),
    }).then(j<{ stage: string; result: PruneResult }>),
  runDedupe: (id: string, threshold?: number) =>
    fetch(`${BASE}/api/projects/${id}/dedupe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(threshold ? { threshold } : {}),
    }).then(j<{ stage: string; result: DedupeResult }>),
  runCaption: (id: string, trigger?: string) =>
    fetch(`${BASE}/api/projects/${id}/caption`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: trigger ?? "" }),
    }).then(j<{ jobId: string; remoteId: string }>),

  runTrain: (id: string, steps?: number) =>
    fetch(`${BASE}/api/projects/${id}/train`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(steps ? { steps } : {}),
    }).then(j<{ jobId: string; remoteId: string }>),
  runTest: (id: string, prompt?: string) =>
    fetch(`${BASE}/api/projects/${id}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prompt ? { prompt } : {}),
    }).then(j<{ jobId: string; remoteId: string }>),
  getSamples: (id: string) =>
    fetch(`${BASE}/api/projects/${id}/samples`).then(j<{ files: string[] }>),
  sampleUrl: (id: string, f: string) =>
    `${BASE}/api/projects/${id}/sample?f=${encodeURIComponent(f)}`,

  runNoop: () =>
    fetch(`${BASE}/api/jobs/noop`, { method: "POST" }).then(j<{ jobId: string }>),

  // Streams log lines for a job over a websocket. Returns a close fn.
  streamLogs(
    id: string,
    onLine: (line: string) => void,
    onDone: (job: Job) => void,
    onError?: (msg: string) => void,
  ) {
    const ws = new WebSocket(`${WS_BASE}/ws/jobs/${id}/logs`);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "line") onLine(msg.line);
      else if (msg.type === "done") onDone(msg.job);
    };
    ws.onerror = () => onError?.("log stream error");
    return () => ws.close();
  },
};
