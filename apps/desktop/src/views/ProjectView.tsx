import { useState } from "react";
import { api, type Project } from "../api";
import { Button, Badge, Card, LogConsole, TextInput, Field } from "../ui";

type StageState = "idle" | "running" | "done" | "error";

function StageRow({
  index,
  title,
  desc,
  state,
  summary,
  action,
  disabled,
  children,
}: {
  index: number;
  title: string;
  desc: string;
  state: StageState;
  summary?: string;
  action?: React.ReactNode;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const badge =
    state === "done" ? (
      <Badge tone="ok">done</Badge>
    ) : state === "running" ? (
      <Badge tone="accent">running…</Badge>
    ) : state === "error" ? (
      <Badge tone="err">error</Badge>
    ) : disabled ? (
      <Badge tone="muted">soon</Badge>
    ) : (
      <Badge tone="muted">pending</Badge>
    );

  return (
    <Card className={`p-4 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-4">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
            state === "done"
              ? "border-ok/40 bg-ok/10 text-ok"
              : "border-border bg-panel-2 text-muted"
          }`}
        >
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-fg">{title}</h3>
            {badge}
          </div>
          <p className="truncate text-sm text-muted">{summary ?? desc}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function ProjectView({
  project: initial,
  onBack,
}: {
  project: Project;
  onBack: () => void;
}) {
  const [project, setProject] = useState(initial);
  const [pruneState, setPruneState] = useState<StageState>(
    initial.stages.prune ? "done" : "idle",
  );
  const [dedupeState, setDedupeState] = useState<StageState>(
    initial.stages.dedupe ? "done" : "idle",
  );
  const [capState, setCapState] = useState<StageState>("idle");
  const [trigger, setTrigger] = useState("");
  const [capLines, setCapLines] = useState<string[]>([]);
  const [err, setErr] = useState<string>();

  async function refresh() {
    setProject(await api.getProject(project.id));
  }

  async function runPrune() {
    setPruneState("running");
    setErr(undefined);
    try {
      await api.runPrune(project.id);
      await refresh();
      setPruneState("done");
    } catch (e) {
      setErr(String(e));
      setPruneState("error");
    }
  }

  async function runDedupe() {
    setDedupeState("running");
    setErr(undefined);
    try {
      await api.runDedupe(project.id);
      await refresh();
      setDedupeState("done");
    } catch (e) {
      setErr(String(e));
      setDedupeState("error");
    }
  }

  async function runCaption() {
    setCapState("running");
    setCapLines([]);
    setErr(undefined);
    try {
      const { jobId } = await api.runCaption(project.id, trigger.trim());
      const close = api.streamLogs(
        jobId,
        (line) => setCapLines((l) => [...l, line]),
        (job) => {
          setCapState(job.status === "succeeded" ? "done" : "error");
          close();
        },
        (m) => {
          setCapLines((l) => [...l, m]);
          setCapState("error");
        },
      );
    } catch (e) {
      setErr(String(e));
      setCapState("error");
    }
  }

  const p = project.stages.prune;
  const d = project.stages.dedupe;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack}>
          ← Projects
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-fg">{project.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <Badge tone="accent">{project.baseModel}</Badge>
            <Badge>{project.trainType}</Badge>
            <span>· {project.source.imageCount} source images</span>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-err/30 bg-err/10 px-4 py-2 text-sm text-err">
          {err}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <StageRow
          index={1}
          title="Source"
          desc="Images copied into the project"
          state="done"
          summary={`${project.source.imageCount} images copied from ${project.source.inputFolder}`}
        />

        <StageRow
          index={2}
          title="Prune"
          desc="Remove images below the minimum dimension"
          state={pruneState}
          summary={
            p
              ? `${p.kept} kept · ${p.pruned} pruned (min ${p.minDim}px)`
              : undefined
          }
          action={
            <Button
              onClick={runPrune}
              disabled={pruneState === "running"}
              variant={pruneState === "done" ? "subtle" : "primary"}
            >
              {pruneState === "running"
                ? "Pruning…"
                : pruneState === "done"
                  ? "Re-run"
                  : "Run"}
            </Button>
          }
        />

        <StageRow
          index={3}
          title="Dedupe"
          desc="Remove near-duplicate images (perceptual hash)"
          state={dedupeState}
          summary={
            d ? `${d.kept} kept · ${d.removed} removed` : undefined
          }
          action={
            <Button
              onClick={runDedupe}
              disabled={dedupeState === "running" || !p}
              variant={dedupeState === "done" ? "subtle" : "primary"}
            >
              {dedupeState === "running"
                ? "Deduping…"
                : dedupeState === "done"
                  ? "Re-run"
                  : "Run"}
            </Button>
          }
        />

        <StageRow
          index={4}
          title="Caption"
          desc="Caption images with vLLM on the GB10"
          state={capState}
          action={
            <Button
              onClick={runCaption}
              disabled={capState === "running" || !d}
              variant={capState === "done" ? "subtle" : "primary"}
            >
              {capState === "running"
                ? "Captioning…"
                : capState === "done"
                  ? "Re-run"
                  : "Run"}
            </Button>
          }
        >
          <div className="mt-4 flex flex-col gap-3">
            <Field
              label="Trigger token"
              hint="Optional word prefixed to every caption (your LoRA's activation token)."
            >
              <TextInput
                value={trigger}
                onChange={(e) => setTrigger(e.currentTarget.value)}
                placeholder="e.g. tok1 (optional)"
                className="max-w-xs"
              />
            </Field>
            {(capState !== "idle" || capLines.length > 0) && (
              <LogConsole
                lines={capLines}
                className="h-56"
                empty="Waiting for the GB10…"
              />
            )}
          </div>
        </StageRow>

        <StageRow
          index={5}
          title="Train & Test"
          desc="Train a LoRA and generate test images"
          state="idle"
          disabled
          summary="Coming next — needs the Flux base model on the GB10"
        />
      </div>
    </div>
  );
}
