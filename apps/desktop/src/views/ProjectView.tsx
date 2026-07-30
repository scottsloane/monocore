import { useState } from "react";
import { api, type Project, type TrainMode } from "../api";
import {
  Button,
  Badge,
  LogConsole,
  TextInput,
  Field,
  Segmented,
  StageRow,
  type StageState,
} from "../ui";
import { EltStage } from "./EltStage";

// Human summary of the VRAM auto-tuning for the ~128GB GB10.
function vramSummary(base: string, mode: TrainMode): string {
  if (mode === "full") return "full fine-tune · gradient checkpointing";
  if (base === "sdxl") return "LoRA · bf16 · batch 4 (uses the 128GB)";
  if (base === "wan") return "LoRA · quantized (14B video model)";
  return "LoRA · bf16, no quantize (uses the 128GB)";
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
  const [elt, setElt] = useState({
    quality: !!initial.stages.quality,
    subject: !!initial.stages.subject,
    crop: !!initial.stages.crop,
  });
  const [capState, setCapState] = useState<StageState>("idle");
  const [trigger, setTrigger] = useState(initial.settings.trigger ?? "");
  const [capLines, setCapLines] = useState<string[]>([]);
  const [trainState, setTrainState] = useState<StageState>("idle");
  const [trainLines, setTrainLines] = useState<string[]>([]);
  const [steps, setSteps] = useState<number>(initial.settings.steps);
  const [mode, setMode] = useState<TrainMode>(initial.settings.trainMode);
  const [trainJob, setTrainJob] = useState<string>();
  const [trainSamples, setTrainSamples] = useState<string[]>([]);
  const [testState, setTestState] = useState<StageState>("idle");
  const [testLines, setTestLines] = useState<string[]>([]);
  const [samples, setSamples] = useState<string[]>([]);
  const [err, setErr] = useState<string>();

  async function refresh() {
    setProject(await api.getProject(project.id));
  }

  async function runLocal(
    fn: () => Promise<unknown>,
    set: (s: StageState) => void,
  ) {
    set("running");
    setErr(undefined);
    try {
      await fn();
      await refresh();
      set("done");
    } catch (e) {
      setErr(String(e));
      set("error");
    }
  }

  function streamStage(
    jobId: string,
    setState: (s: StageState) => void,
    setLines: (fn: (l: string[]) => string[]) => void,
    onDone?: (ok: boolean) => void,
  ) {
    const close = api.streamLogs(
      jobId,
      (line) => setLines((l) => [...l, line]),
      (job) => {
        const ok = job.status === "succeeded";
        setState(ok ? "done" : "error");
        onDone?.(ok);
        close();
      },
      (m) => {
        setLines((l) => [...l, m]);
        setState("error");
      },
    );
  }

  async function runCaption() {
    setCapState("running");
    setCapLines([]);
    setErr(undefined);
    try {
      const { jobId } = await api.runCaption(project.id, trigger.trim());
      streamStage(jobId, setCapState, setCapLines);
    } catch (e) {
      setErr(String(e));
      setCapState("error");
    }
  }

  async function runTrain() {
    setTrainState("running");
    setTrainLines([]);
    setTrainSamples([]);
    setErr(undefined);
    try {
      const { jobId } = await api.runTrain(project.id, { steps, mode });
      setTrainJob(jobId);
      streamStage(jobId, setTrainState, setTrainLines, async (ok) => {
        if (ok) {
          try {
            setTrainSamples((await api.getTrainSamples(project.id)).files);
          } catch {
            /* ignore */
          }
        }
      });
    } catch (e) {
      setErr(String(e));
      setTrainState("error");
    }
  }

  async function cancelTrain() {
    if (!trainJob) return;
    try {
      await api.cancelJob(trainJob);
      setTrainLines((l) => [...l, "[canceling…]"]);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function runTest() {
    setTestState("running");
    setTestLines([]);
    setSamples([]);
    setErr(undefined);
    try {
      const { jobId } = await api.runTest(project.id);
      streamStage(jobId, setTestState, setTestLines, async (ok) => {
        if (ok) {
          try {
            setSamples((await api.getSamples(project.id)).files);
          } catch {
            /* ignore */
          }
        }
      });
    } catch (e) {
      setErr(String(e));
      setTestState("error");
    }
  }

  const p = project.stages.prune;
  const d = project.stages.dedupe;
  const dedupeDone = dedupeState === "done";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack}>
          ← Projects
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-fg">{project.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone="accent">{project.baseModel}</Badge>
            <Badge>{project.trainType}</Badge>
            {project.subject && <span>· “{project.subject}”</span>}
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
          summary={`${project.source.imageCount} images from ${project.source.inputFolder}`}
        />

        <StageRow
          index={2}
          title="Prune"
          desc="Remove images below the minimum dimension"
          state={pruneState}
          summary={
            p ? `${p.kept} kept · ${p.pruned} pruned (min ${p.minDim}px)` : undefined
          }
          action={
            <Button
              onClick={() => runLocal(() => api.runPrune(project.id), setPruneState)}
              disabled={pruneState === "running"}
              variant={pruneState === "done" ? "subtle" : "primary"}
            >
              {pruneState === "running" ? "Pruning…" : pruneState === "done" ? "Re-run" : "Run"}
            </Button>
          }
        />

        <StageRow
          index={3}
          title="Dedupe"
          desc="Remove near-duplicate images (perceptual hash)"
          state={dedupeState}
          disabled={pruneState !== "done"}
          summary={d ? `${d.kept} kept · ${d.removed} removed` : undefined}
          action={
            <Button
              onClick={() => runLocal(() => api.runDedupe(project.id), setDedupeState)}
              disabled={dedupeState === "running" || pruneState !== "done"}
              variant={dedupeState === "done" ? "subtle" : "primary"}
            >
              {dedupeState === "running" ? "Deduping…" : dedupeState === "done" ? "Re-run" : "Run"}
            </Button>
          }
        />

        <EltStage
          projectId={project.id}
          index={4}
          stage="quality"
          title="Quality"
          desc="Score images with vLLM and drop low-quality ones"
          enabled={dedupeDone}
          onDone={() => setElt((e) => ({ ...e, quality: true }))}
        />
        <EltStage
          projectId={project.id}
          index={5}
          stage="subject"
          title="Subject"
          desc="Keep only images matching the subject / aesthetic (vLLM)"
          enabled={elt.quality}
          onDone={() => setElt((e) => ({ ...e, subject: true }))}
        />
        <EltStage
          projectId={project.id}
          index={6}
          stage="crop"
          title="Crop"
          desc="Subject-aware crop where it helps (vLLM bounding box)"
          enabled={elt.subject}
          onDone={() => setElt((e) => ({ ...e, crop: true }))}
        />

        <StageRow
          index={7}
          title="Caption"
          desc="Caption the final set with vLLM on the GB10"
          state={capState}
          disabled={!dedupeDone}
          action={
            <Button
              onClick={runCaption}
              disabled={capState === "running" || !dedupeDone}
              variant={capState === "done" ? "subtle" : "primary"}
            >
              {capState === "running" ? "Captioning…" : capState === "done" ? "Re-run" : "Run"}
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
              <LogConsole lines={capLines} className="h-56" empty="Waiting for the GB10…" />
            )}
          </div>
        </StageRow>

        <StageRow
          index={8}
          title="Train"
          desc={`Train a ${project.baseModel.toUpperCase()} model on the captioned dataset (GB10)`}
          state={trainState}
          disabled={capState !== "done"}
          summary={`${vramSummary(project.baseModel, mode)}`}
          action={
            trainState === "running" ? (
              <Button variant="ghost" onClick={cancelTrain}>
                Cancel
              </Button>
            ) : (
              <Button
                onClick={runTrain}
                disabled={capState !== "done"}
                variant={trainState === "done" ? "subtle" : "primary"}
              >
                {trainState === "done" ? "Re-run" : "Run"}
              </Button>
            )
          }
        >
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Mode">
                <Segmented<TrainMode>
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "lora", label: "LoRA" },
                    { value: "full", label: "Full fine-tune" },
                  ]}
                />
              </Field>
              <Field label="Steps" hint="Lower = faster test run.">
                <TextInput
                  type="number"
                  value={steps}
                  onChange={(e) => setSteps(Number(e.currentTarget.value))}
                  className="max-w-[8rem]"
                />
              </Field>
            </div>
            {(trainState !== "idle" || trainLines.length > 0) && (
              <LogConsole lines={trainLines} className="h-56" empty="Waiting for the GB10 trainer…" />
            )}
            {trainSamples.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted">In-training samples</p>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {trainSamples.map((f) => (
                    <img
                      key={f}
                      src={api.trainSampleUrl(project.id, f)}
                      alt={f}
                      className="aspect-square w-full rounded-lg border border-border object-cover"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </StageRow>

        <StageRow
          index={9}
          title="Test"
          desc="Generate sample images with the trained LoRA"
          state={testState}
          disabled={trainState !== "done"}
          action={
            <Button
              onClick={runTest}
              disabled={testState === "running" || trainState !== "done"}
              variant={testState === "done" ? "subtle" : "primary"}
            >
              {testState === "running" ? "Generating…" : testState === "done" ? "Re-run" : "Run"}
            </Button>
          }
        >
          <div className="mt-4 flex flex-col gap-3">
            {(testState !== "idle" || testLines.length > 0) && (
              <LogConsole lines={testLines} className="h-40" empty="Waiting for the GB10…" />
            )}
            {samples.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {samples.map((f) => (
                  <img
                    key={f}
                    src={api.sampleUrl(project.id, f)}
                    alt={f}
                    className="aspect-square w-full rounded-lg border border-border object-cover"
                  />
                ))}
              </div>
            )}
          </div>
        </StageRow>
      </div>
    </div>
  );
}
