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
  syncToGb10,
  syncFromGb10,
  fetchManifest,
  eltOverride,
  cancelRemoteJob,
  removeRemoteProject,
  listArtifacts,
  exportArtifact,
} from "./gb10.ts";
import { MODEL_PATHS, vramProfile, sampleEvery } from "./defaults.ts";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

// ELT stage → (input work subdir, output work subdir). Prune/dedupe run locally
// and produce 00_pruned/01_deduped; these vLLM stages chain on the GB10.
const ELT: Record<string, { in: string; out: string }> = {
  quality: { in: "01_deduped", out: "02_quality" },
  subject: { in: "02_quality", out: "03_subject" },
  crop: { in: "03_subject", out: "04_cropped" },
};

// The work subdir feeding caption/train: the latest ELT stage that has run.
function latestSourceSub(project: {
  stages: Record<string, unknown>;
}): string {
  if (project.stages.crop) return "04_cropped";
  if (project.stages.subject) return "03_subject";
  if (project.stages.quality) return "02_quality";
  return "01_deduped";
}
import {
  createProject,
  listProjects,
  getProject,
  saveProject,
  deleteProjectLocal,
  paths,
  type CreateInput,
} from "./projects.ts";
import { prune } from "./pipeline/prune.ts";
import { dedupe } from "./pipeline/dedupe.ts";

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

    // --- Projects -------------------------------------------------------
    // GET /api/projects
    if (pathname === "/api/projects" && req.method === "GET") {
      return json({ projects: listProjects() });
    }

    // POST /api/projects  { name, baseModel, trainType, inputFolder }
    if (pathname === "/api/projects" && req.method === "POST") {
      try {
        const body = (await req.json()) as CreateInput;
        return json(createProject(body), 201);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 400);
      }
    }

    // GET /api/projects/:id
    const projMatch = pathname.match(/^\/api\/projects\/([\w-]+)$/);
    if (projMatch && req.method === "GET") {
      const p = getProject(projMatch[1]);
      return p ? json(p) : json({ error: "not found" }, 404);
    }

    // DELETE /api/projects/:id  → remove local + GB10 dirs + db rows
    if (projMatch && req.method === "DELETE") {
      const id = projMatch[1];
      if (!getProject(id)) return json({ error: "not found" }, 404);
      try {
        if (tunnelUp()) await removeRemoteProject(id).catch(() => {});
        deleteProjectLocal(id);
        return json({ ok: true });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    // POST /api/projects/:id/prune | /dedupe  (local ELT stages)
    const stageMatch = pathname.match(
      /^\/api\/projects\/([\w-]+)\/(prune|dedupe)$/,
    );
    if (stageMatch && req.method === "POST") {
      const project = getProject(stageMatch[1]);
      if (!project) return json({ error: "not found" }, 404);
      const stage = stageMatch[2];
      try {
        const body = (await req.json().catch(() => ({}))) as Record<
          string,
          number
        >;
        const result =
          stage === "prune"
            ? await prune(project, body.minDim ?? project.settings.minDim)
            : await dedupe(
                project,
                body.threshold ?? project.settings.dedupeThreshold,
              );
        project.stages[stage] = result;
        project.status = stage;
        saveProject(project);
        return json({ stage, result });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    // POST /api/projects/:id/elt/:stage  → run a vLLM ELT stage on the GB10
    const eltRun = pathname.match(
      /^\/api\/projects\/([\w-]+)\/elt\/(quality|subject|crop)$/,
    );
    if (eltRun && req.method === "POST") {
      const project = getProject(eltRun[1]);
      if (!project) return json({ error: "not found" }, 404);
      if (!tunnelUp()) return json({ error: "gb10 tunnel down" }, 503);
      const stage = eltRun[2];
      const cfg = ELT[stage];
      try {
        const body = (await req.json().catch(() => ({}))) as {
          threshold?: number;
        };
        // quality is the first GB10 stage — make sure the deduped set is up there
        if (stage === "quality") {
          await syncToGb10(
            paths(project.id).workDir("01_deduped"),
            `monocore/projects/${project.id}/work/01_deduped`,
          );
        }
        const params: Record<string, unknown> = {
          project: project.id,
          in: cfg.in,
          out: cfg.out,
          subject: project.subject,
          type: project.trainType,
        };
        if (stage === "quality")
          params.threshold = body.threshold ?? project.settings.qualityThreshold;
        if (stage === "crop") {
          params.pad = project.settings.cropPadding;
          params.min_side = project.settings.minDim;
        }
        const remote = await createJob(stage, params);
        const id = uid();
        insertJob({
          id,
          project_id: project.id,
          stage,
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

    // GET /api/projects/:id/elt/:stage/manifest  → fetch manifest, record stage
    const eltManifest = pathname.match(
      /^\/api\/projects\/([\w-]+)\/elt\/(quality|subject|crop)\/manifest$/,
    );
    if (eltManifest && req.method === "GET") {
      const project = getProject(eltManifest[1]);
      if (!project) return json({ error: "not found" }, 404);
      const stage = eltManifest[2];
      const cfg = ELT[stage];
      try {
        const manifest = (await fetchManifest(project.id, cfg.out)) as {
          total: number;
          kept: number;
        };
        // crop produces new images — pull them local for before/after review
        if (stage === "crop") {
          await syncFromGb10(
            `monocore/projects/${project.id}/work/04_cropped`,
            paths(project.id).workDir("04_cropped"),
          );
        }
        project.stages[stage] = { total: manifest.total, kept: manifest.kept };
        project.status = stage;
        saveProject(project);
        return json(manifest);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    // POST /api/projects/:id/elt/:stage/override  { file, keep }
    const eltOv = pathname.match(
      /^\/api\/projects\/([\w-]+)\/elt\/(quality|subject|crop)\/override$/,
    );
    if (eltOv && req.method === "POST") {
      const project = getProject(eltOv[1]);
      if (!project) return json({ error: "not found" }, 404);
      const stage = eltOv[2];
      const cfg = ELT[stage];
      try {
        const body = (await req.json()) as { file: string; keep: boolean };
        const manifest = (await eltOverride({
          project: project.id,
          in_sub: cfg.in,
          out_sub: cfg.out,
          file: body.file,
          keep: body.keep,
        })) as { total: number; kept: number };
        project.stages[stage] = { total: manifest.total, kept: manifest.kept };
        saveProject(project);
        return json(manifest);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    // GET /api/projects/:id/work-image?dir=SUB&f=NAME  → serve a review image
    const workImg = pathname.match(/^\/api\/projects\/([\w-]+)\/work-image$/);
    if (workImg && req.method === "GET") {
      const dir = url.searchParams.get("dir") ?? "";
      const f = url.searchParams.get("f") ?? "";
      if (!["01_deduped", "04_cropped"].includes(dir))
        return json({ error: "bad dir" }, 400);
      if (!/^[\w.\-]+\.(png|jpe?g|webp|bmp|tiff?|avif)$/i.test(f))
        return json({ error: "bad filename" }, 400);
      const file = join(paths(workImg[1]).work, dir, f);
      if (!existsSync(file)) return json({ error: "not found" }, 404);
      return new Response(Bun.file(file), { headers: { ...CORS } });
    }

    // POST /api/projects/:id/caption  → sync deduped set + run GB10 caption job
    const capMatch = pathname.match(/^\/api\/projects\/([\w-]+)\/caption$/);
    if (capMatch && req.method === "POST") {
      const project = getProject(capMatch[1]);
      if (!project) return json({ error: "not found" }, 404);
      if (!tunnelUp()) return json({ error: "gb10 tunnel down" }, 503);
      try {
        const body = (await req.json().catch(() => ({}))) as {
          trigger?: string;
        };
        const trigger = body.trigger ?? "";
        const inputSub = latestSourceSub(project);
        // If no ELT stage ran, the deduped set still needs to be on the GB10.
        if (inputSub === "01_deduped") {
          await syncToGb10(
            paths(project.id).workDir("01_deduped"),
            `monocore/projects/${project.id}/work/01_deduped`,
          );
        }
        const remote = await createJob("caption", {
          project: project.id,
          type: project.trainType,
          trigger,
          input_sub: inputSub,
        });
        // remember the trigger so training reuses it as the activation token
        project.settings.trigger = trigger;
        saveProject(project);
        const id = uid();
        insertJob({
          id,
          project_id: project.id,
          stage: "caption",
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

    // POST /api/projects/:id/train | /test  (GB10 GPU stages)
    const gpuMatch = pathname.match(
      /^\/api\/projects\/([\w-]+)\/(train|test)$/,
    );
    if (gpuMatch && req.method === "POST") {
      const project = getProject(gpuMatch[1]);
      if (!project) return json({ error: "not found" }, 404);
      if (!tunnelUp()) return json({ error: "gb10 tunnel down" }, 503);
      const stage = gpuMatch[2];
      try {
        const body = (await req.json().catch(() => ({}))) as {
          steps?: number;
          prompt?: string;
          mode?: "lora" | "full";
        };
        const s = project.settings;
        const trig = s.trigger?.trim();
        const arch = project.baseModel;
        const model = MODEL_PATHS[arch];
        const mode = body.mode ?? s.trainMode;
        const vp = vramProfile(arch, mode);
        const steps = body.steps ?? s.steps;
        const params =
          stage === "train"
            ? {
                project: project.id,
                arch,
                mode,
                model,
                steps,
                rank: s.rank,
                lr: s.learningRate,
                resolution: s.resolution,
                batch: vp.batchSize,
                quantize: vp.quantize,
                gc: vp.gradientCheckpointing,
                sample_every: sampleEvery(steps),
                trigger: trig ?? "",
              }
            : {
                project: project.id,
                arch,
                model,
                prompt:
                  body.prompt ??
                  `${trig ? trig + ", " : ""}a professional photograph, sharp focus`,
                n: 2,
              };
        const remote = await createJob(stage, params);
        const id = uid();
        insertJob({
          id,
          project_id: project.id,
          stage,
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

    // GET /api/projects/:id/artifacts  → list trained LoRA files on the GB10
    const artMatch = pathname.match(/^\/api\/projects\/([\w-]+)\/artifacts$/);
    if (artMatch && req.method === "GET") {
      if (!getProject(artMatch[1])) return json({ error: "not found" }, 404);
      if (!tunnelUp()) return json({ artifacts: [] });
      try {
        return json({ artifacts: await listArtifacts(artMatch[1]) });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    // POST /api/projects/:id/export  { path, dest }  → copy a LoRA to a folder
    const exportMatch = pathname.match(/^\/api\/projects\/([\w-]+)\/export$/);
    if (exportMatch && req.method === "POST") {
      if (!getProject(exportMatch[1])) return json({ error: "not found" }, 404);
      try {
        const body = (await req.json()) as { path: string; dest: string };
        if (!body.dest?.trim()) return json({ error: "dest required" }, 400);
        if (!existsSync(body.dest))
          return json({ error: `folder not found: ${body.dest}` }, 400);
        const out = await exportArtifact(exportMatch[1], body.path, body.dest);
        return json({ exported: out });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    // GET /api/projects/:id/samples  → pull test images from GB10, list them
    const samplesMatch = pathname.match(/^\/api\/projects\/([\w-]+)\/samples$/);
    if (samplesMatch && req.method === "GET") {
      const project = getProject(samplesMatch[1]);
      if (!project) return json({ error: "not found" }, 404);
      try {
        const local = join(paths(project.id).output, "test");
        await syncFromGb10(
          `monocore/projects/${project.id}/output/test`,
          local,
        );
        const files = existsSync(local)
          ? readdirSync(local).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
          : [];
        return json({ files });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    // GET /api/projects/:id/sample?f=NAME  → serve a test image
    const sampleMatch = pathname.match(/^\/api\/projects\/([\w-]+)\/sample$/);
    if (sampleMatch && req.method === "GET") {
      const f = url.searchParams.get("f") ?? "";
      if (!/^[\w.\-]+\.(png|jpe?g|webp)$/i.test(f))
        return json({ error: "bad filename" }, 400);
      const file = join(paths(sampleMatch[1]).output, "test", f);
      if (!existsSync(file)) return json({ error: "not found" }, 404);
      return new Response(Bun.file(file), { headers: { ...CORS } });
    }

    // GET /api/projects/:id/train-samples  → pull ai-toolkit in-training samples
    const trSamples = pathname.match(
      /^\/api\/projects\/([\w-]+)\/train-samples$/,
    );
    if (trSamples && req.method === "GET") {
      const project = getProject(trSamples[1]);
      if (!project) return json({ error: "not found" }, 404);
      try {
        const local = join(paths(project.id).output, "train_samples");
        await syncFromGb10(
          `monocore/projects/${project.id}/output/${project.id}/samples`,
          local,
        );
        const files = existsSync(local)
          ? readdirSync(local)
              .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
              .sort()
          : [];
        return json({ files });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    // GET /api/projects/:id/train-sample?f=NAME  → serve a training sample
    const trSample = pathname.match(/^\/api\/projects\/([\w-]+)\/train-sample$/);
    if (trSample && req.method === "GET") {
      const f = url.searchParams.get("f") ?? "";
      if (!/^[\w.\-]+\.(png|jpe?g|webp)$/i.test(f))
        return json({ error: "bad filename" }, 400);
      const file = join(paths(trSample[1]).output, "train_samples", f);
      if (!existsSync(file)) return json({ error: "not found" }, 404);
      return new Response(Bun.file(file), { headers: { ...CORS } });
    }

    // POST /api/jobs/:id/cancel  → cancel a running/queued GB10 job
    const cancelMatch = pathname.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      const row = getJob(cancelMatch[1]);
      if (!row?.remote_id) return json({ error: "not found" }, 404);
      try {
        await cancelRemoteJob(row.remote_id);
        updateJob(row.id, { status: "canceled", finished_at: nowIso() });
        return json({ ok: true });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
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
              evt.job.status === "succeeded"
                ? "succeeded"
                : evt.job.status === "canceled"
                  ? "canceled"
                  : "failed";
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
