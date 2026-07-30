// Manages the SSH tunnel to the GB10 and talks to its FastAPI job API.
import type { Subprocess } from "bun";
import { config, gb10BaseUrl } from "./config.ts";

let tunnel: Subprocess | null = null;
let stopped = false;

/** Open (and keep alive) an `ssh -L` tunnel to the GB10 job API. */
export function startTunnel() {
  if (tunnel) return;
  const { sshHost, localPort, remotePort } = config.gb10;
  tunnel = Bun.spawn(
    [
      "ssh",
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      `${localPort}:127.0.0.1:${remotePort}`,
      sshHost,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  tunnel.exited.then(() => {
    tunnel = null;
    if (!stopped) setTimeout(startTunnel, 2000); // auto-reconnect
  });
}

export function stopTunnel() {
  stopped = true;
  tunnel?.kill();
  tunnel = null;
}

export const tunnelUp = () => tunnel !== null;

async function gb10Fetch(path: string, init?: RequestInit, timeoutMs = 4000) {
  return fetch(`${gb10BaseUrl()}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export type Gb10Health = {
  reachable: boolean;
  tunnel: boolean;
  models: string[];
  error?: string;
};

export async function health(): Promise<Gb10Health> {
  if (!tunnelUp()) return { reachable: false, tunnel: false, models: [] };
  try {
    const res = await gb10Fetch("/health");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { models?: string[] };
    return { reachable: true, tunnel: true, models: body.models ?? [] };
  } catch (e) {
    return {
      reachable: false,
      tunnel: true,
      models: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function run(cmd: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    p.exited.then(async (code) => {
      if (code === 0) return resolve();
      const err = await new Response(p.stderr).text();
      reject(new Error(`${cmd[0]} exited ${code}: ${err.trim()}`));
    });
  });
}

/**
 * Mirror a local directory to a path under the GB10 home (relative to ~), e.g.
 * `monocore/projects/<id>/input`. Creates the remote path and rsyncs contents.
 */
export async function syncToGb10(
  localDir: string,
  remoteRel: string,
): Promise<void> {
  const host = config.gb10.sshHost;
  await run(["ssh", host, `mkdir -p ${remoteRel}`]);
  await run([
    "rsync",
    "-az",
    "--delete",
    `${localDir.replace(/\/?$/, "")}/`,
    `${host}:${remoteRel}/`,
  ]);
}

/** Pull a directory from under the GB10 home (relative to ~) to a local dir. */
export async function syncFromGb10(
  remoteRel: string,
  localDir: string,
): Promise<void> {
  const host = config.gb10.sshHost;
  await run(["mkdir", "-p", localDir]);
  await run([
    "rsync",
    "-az",
    `${host}:${remoteRel}/`,
    `${localDir.replace(/\/?$/, "")}/`,
  ]);
}

export async function createJob(
  stage: string,
  params: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const res = await gb10Fetch("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage, params }),
  });
  if (!res.ok) throw new Error(`GB10 createJob failed: HTTP ${res.status}`);
  return (await res.json()) as { id: string };
}

export async function fetchManifest(
  project: string,
  outSub: string,
): Promise<unknown> {
  const res = await gb10Fetch(
    `/elt/manifest?project=${project}&out_sub=${outSub}`,
  );
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
  return res.json();
}

export async function eltOverride(body: {
  project: string;
  in_sub: string;
  out_sub: string;
  file: string;
  keep: boolean;
}): Promise<unknown> {
  const res = await gb10Fetch("/elt/override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`override failed: HTTP ${res.status}`);
  return res.json();
}

export type RemoteJob = {
  id: string;
  stage: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  exit_code?: number | null;
};

export async function cancelRemoteJob(id: string): Promise<void> {
  const res = await gb10Fetch(`/jobs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`cancel failed: HTTP ${res.status}`);
}

export async function getRemoteJob(id: string): Promise<RemoteJob> {
  const res = await gb10Fetch(`/jobs/${id}`);
  if (!res.ok) throw new Error(`GB10 getJob failed: HTTP ${res.status}`);
  return (await res.json()) as RemoteJob;
}

/**
 * Stream a remote job's log lines. Yields `{type:'line', line}` for each output
 * line and finally `{type:'done', job}`. Consumes the GB10 SSE endpoint.
 */
export async function* streamLogs(
  id: string,
): AsyncGenerator<
  { type: "line"; line: string } | { type: "done"; job: RemoteJob }
> {
  const res = await gb10Fetch(
    `/jobs/${id}/logs`,
    { headers: { accept: "text/event-stream" } },
    1000 * 60 * 60, // long-lived stream
  );
  if (!res.body) throw new Error("no log stream body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const evt of events) {
      // SSE frame: optional `event:` + `data:` lines
      const dataLine = evt
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = JSON.parse(dataLine.slice(5).trim());
      if (payload.done) {
        yield { type: "done", job: payload.job as RemoteJob };
        return;
      }
      yield { type: "line", line: payload.line as string };
    }
  }
}
