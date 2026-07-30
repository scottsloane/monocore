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

export type RemoteJob = {
  id: string;
  stage: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  exit_code?: number | null;
};

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
