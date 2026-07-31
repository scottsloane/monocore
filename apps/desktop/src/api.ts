// Client for the local bun backend sidecar.
const BASE = "http://localhost:8787";
const WS_BASE = "ws://localhost:8787";

export type Gb10Health = {
  reachable: boolean;
  tunnel: boolean;
  models: string[];
  diskFreeGb?: number | null;
  gpu?: string | null;
  error?: string;
};

export type Artifact = { name: string; path: string; sizeMB: number };

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
export type TrainMode = "lora" | "full";

export type Settings = {
  resolution: number;
  minDim: number;
  dedupeThreshold: number;
  qualityThreshold: number;
  cropPadding: number;
  steps: number;
  learningRate: number;
  rank: number;
  trainMode: TrainMode;
  trigger?: string;
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

export type EltStage = "quality" | "subject" | "crop";
export type EltItem = {
  file: string;
  keep: boolean;
  score?: number;
  reason?: string;
  match?: boolean;
  cropped?: boolean;
  box?: number[];
};
export type EltManifest = {
  stage: string;
  total: number;
  kept: number;
  items: EltItem[];
};

export type Project = {
  id: string;
  name: string;
  baseModel: BaseModel;
  trainType: TrainType;
  subject: string;
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
  subject?: string;
  overrides?: Partial<Settings>;
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
  deleteProject: (id: string) =>
    fetch(`${BASE}/api/projects/${id}`, { method: "DELETE" }).then(
      j<{ ok: boolean }>,
    ),
  getArtifacts: (id: string) =>
    fetch(`${BASE}/api/projects/${id}/artifacts`).then(
      j<{ artifacts: Artifact[] }>,
    ),
  exportArtifact: (id: string, path: string, dest: string) =>
    fetch(`${BASE}/api/projects/${id}/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, dest }),
    }).then(j<{ exported: string }>),

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

  runElt: (id: string, stage: EltStage, body: Record<string, number> = {}) =>
    fetch(`${BASE}/api/projects/${id}/elt/${stage}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(j<{ jobId: string; remoteId: string }>),
  getEltManifest: (id: string, stage: EltStage) =>
    fetch(`${BASE}/api/projects/${id}/elt/${stage}/manifest`).then(
      j<EltManifest>,
    ),
  eltOverride: (id: string, stage: EltStage, file: string, keep: boolean) =>
    fetch(`${BASE}/api/projects/${id}/elt/${stage}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file, keep }),
    }).then(j<EltManifest>),
  workImageUrl: (id: string, dir: string, f: string) =>
    `${BASE}/api/projects/${id}/work-image?dir=${dir}&f=${encodeURIComponent(f)}`,

  runTrain: (id: string, opts: { steps?: number; mode?: TrainMode } = {}) =>
    fetch(`${BASE}/api/projects/${id}/train`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    }).then(j<{ jobId: string; remoteId: string }>),
  cancelJob: (jobId: string) =>
    fetch(`${BASE}/api/jobs/${jobId}/cancel`, { method: "POST" }).then(
      j<{ ok: boolean }>,
    ),
  getTrainSamples: (id: string) =>
    fetch(`${BASE}/api/projects/${id}/train-samples`).then(
      j<{ files: string[] }>,
    ),
  trainSampleUrl: (id: string, f: string) =>
    `${BASE}/api/projects/${id}/train-sample?f=${encodeURIComponent(f)}`,
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
