import { useState } from "react";
import { api, type EltStage as Stage, type EltManifest, type EltItem } from "../api";
import { Button, StageRow, LogConsole, Badge, type StageState } from "../ui";

function itemBadge(stage: Stage, it: EltItem) {
  if (stage === "quality")
    return (
      <Badge tone={it.keep ? "ok" : "err"}>
        {it.score?.toFixed(1) ?? "—"}
      </Badge>
    );
  if (stage === "subject")
    return <Badge tone={it.match ? "ok" : "err"}>{it.match ? "match" : "no"}</Badge>;
  return <Badge tone={it.cropped ? "accent" : "muted"}>{it.cropped ? "cropped" : "full"}</Badge>;
}

function ReviewGrid({
  projectId,
  stage,
  items,
  onToggle,
}: {
  projectId: string;
  stage: Stage;
  items: EltItem[];
  onToggle?: (file: string, keep: boolean) => void;
}) {
  const dir = stage === "crop" ? "04_cropped" : "01_deduped";
  return (
    <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
      {items.map((it) => (
        <div
          key={it.file}
          className={`group relative overflow-hidden rounded-lg border transition ${
            it.keep ? "border-ok/40" : "border-err/40 opacity-50"
          }`}
          title={it.reason}
        >
          <img
            src={api.workImageUrl(projectId, dir, it.file)}
            alt={it.file}
            className="aspect-square w-full object-cover"
            loading="lazy"
          />
          <div className="absolute top-1 left-1">{itemBadge(stage, it)}</div>
          {onToggle && (
            <button
              onClick={() => onToggle(it.file, !it.keep)}
              className="absolute right-1 bottom-1 rounded-md bg-black/70 px-2 py-0.5 text-xs text-fg opacity-0 transition group-hover:opacity-100"
            >
              {it.keep ? "Reject" : "Accept"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function EltStage({
  projectId,
  index,
  stage,
  title,
  desc,
  enabled,
  onDone,
}: {
  projectId: string;
  index: number;
  stage: Stage;
  title: string;
  desc: string;
  enabled: boolean;
  onDone?: () => void;
}) {
  const [state, setState] = useState<StageState>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [manifest, setManifest] = useState<EltManifest>();
  const [err, setErr] = useState<string>();

  async function run() {
    setState("running");
    setLines([]);
    setManifest(undefined);
    setErr(undefined);
    try {
      const { jobId } = await api.runElt(projectId, stage);
      const close = api.streamLogs(
        jobId,
        (line) => setLines((l) => [...l, line]),
        async (job) => {
          close();
          if (job.status !== "succeeded") {
            setState("error");
            return;
          }
          try {
            setManifest(await api.getEltManifest(projectId, stage));
            setState("done");
            onDone?.();
          } catch (e) {
            setErr(String(e));
            setState("error");
          }
        },
        (m) => {
          setLines((l) => [...l, m]);
          setState("error");
        },
      );
    } catch (e) {
      setErr(String(e));
      setState("error");
    }
  }

  async function toggle(file: string, keep: boolean) {
    try {
      setManifest(await api.eltOverride(projectId, stage, file, keep));
    } catch (e) {
      setErr(String(e));
    }
  }

  const summary = manifest
    ? `${manifest.kept}/${manifest.total} kept`
    : undefined;

  return (
    <StageRow
      index={index}
      title={title}
      desc={desc}
      state={enabled ? state : "idle"}
      disabled={!enabled}
      summary={summary}
      action={
        <Button
          onClick={run}
          disabled={!enabled || state === "running"}
          variant={state === "done" ? "subtle" : "primary"}
        >
          {state === "running"
            ? "Running…"
            : state === "done"
              ? "Re-run"
              : "Run"}
        </Button>
      }
    >
      {(state === "running" || lines.length > 0) && !manifest && (
        <LogConsole lines={lines} className="mt-3 h-40" empty="Waiting for the GB10…" />
      )}
      {err && <div className="mt-2 text-xs text-err">{err}</div>}
      {manifest && (
        <ReviewGrid
          projectId={projectId}
          stage={stage}
          items={manifest.items}
          onToggle={stage === "crop" ? undefined : toggle}
        />
      )}
    </StageRow>
  );
}
