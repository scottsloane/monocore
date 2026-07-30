// MONOCORE local orchestrator: the desktop UI's backend. Manages the GB10 SSH
// tunnel, mirrors jobs into SQLite, and proxies job submission + log streaming.
import { config } from "./config.ts";
import { insertJob, updateJob, getJob } from "./db.ts";
import {
  startTunnel,
  stopTunnel,
  tunnelUp,
  health as gb10Health,
  createJob,
  streamLogs,
} from "./gb10.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID().slice(0, 8);

type WsData = { jobId: string };

startTunnel();

// Tear down the SSH tunnel when the backend exits so its child `ssh` doesn't
// orphan and hold the local forward port.
function shutdown() {
  stopTunnel();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", stopTunnel);

const server = Bun.serve<WsData>({
  port: config.port,

  async fetch(req, server) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    // GET /api/health
    if (pathname === "/api/health" && req.method === "GET") {
      const gb10 = await gb10Health();
      return json({ backend: "ok", version: config.version, gb10 });
    }

    // POST /api/jobs/noop — submit a no-op job to the GB10
    if (pathname === "/api/jobs/noop" && req.method === "POST") {
      if (!tunnelUp()) return json({ error: "gb10 tunnel down" }, 503);
      try {
        const remote = await createJob("noop");
        const id = uid();
        insertJob({
          id,
          project_id: null,
          stage: "noop",
          status: "running",
          remote_id: remote.id,
          exit_code: null,
          created_at: nowIso(),
          finished_at: null,
        });
        return json({ jobId: id, remoteId: remote.id });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    // GET /api/jobs/:id
    const jobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)$/);
    if (jobMatch && req.method === "GET") {
      const row = getJob(jobMatch[1]);
      if (!row) return json({ error: "not found" }, 404);
      return json({
        id: row.id,
        stage: row.stage,
        status: row.status,
        createdAt: row.created_at,
        finishedAt: row.finished_at ?? undefined,
        exitCode: row.exit_code ?? undefined,
      });
    }

    // WS /ws/jobs/:id/logs
    const wsMatch = pathname.match(/^\/ws\/jobs\/([\w-]+)\/logs$/);
    if (wsMatch) {
      const ok = server.upgrade(req, { data: { jobId: wsMatch[1] } });
      if (ok) return undefined as unknown as Response;
      return json({ error: "ws upgrade failed" }, 400);
    }

    return json({ error: "not found" }, 404);
  },

  websocket: {
    message() {
      // client is receive-only for log streams
    },
    async open(ws) {
      const { jobId } = ws.data;
      const row = getJob(jobId);
      if (!row?.remote_id) {
        ws.send(JSON.stringify({ type: "line", line: "unknown job" }));
        ws.close();
        return;
      }
      try {
        for await (const evt of streamLogs(row.remote_id)) {
          if (evt.type === "line") {
            ws.send(JSON.stringify({ type: "line", line: evt.line }));
          } else {
            const status =
              evt.job.status === "succeeded" ? "succeeded" : "failed";
            updateJob(jobId, {
              status,
              exit_code: evt.job.exit_code ?? null,
              finished_at: nowIso(),
            });
            const updated = getJob(jobId)!;
            ws.send(
              JSON.stringify({
                type: "done",
                job: {
                  id: updated.id,
                  stage: updated.stage,
                  status: updated.status,
                  createdAt: updated.created_at,
                  finishedAt: updated.finished_at ?? undefined,
                  exitCode: updated.exit_code ?? undefined,
                },
              }),
            );
          }
        }
      } catch (e) {
        ws.send(
          JSON.stringify({
            type: "line",
            line: `stream error: ${e instanceof Error ? e.message : String(e)}`,
          }),
        );
      } finally {
        ws.close();
      }
    },
  },
});

console.log(
  `[monocore] backend on http://localhost:${server.port}  ·  GB10 ${config.gb10.sshHost}`,
);
