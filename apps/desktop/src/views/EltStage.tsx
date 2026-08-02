import { useState } from "react";
import { api, type EltStage as Stage, type EltManifest, type EltItem } from "../api";
import { Button, StageRow, LogConsole, Badge, type StageState } from "../ui";

const PAGE_SIZE = 12;

function itemBadge(stage: Stage, it: EltItem) {
  if (stage === "quality")
    return <Badge tone={it.keep ? "ok" : "err"}>{it.score?.toFixed(1) ?? "—"}</Badge>;
  if (stage === "subject")
    return <Badge tone={it.match ? "ok" : "err"}>{it.match ? "match" : "no"}</Badge>;
  return <Badge tone={it.cropped ? "accent" : "muted"}>{it.cropped ? "cropped" : "full"}</Badge>;
}

/** Paged review grid — only mounts (and loads images) when the user opens it. */
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
  const [page, setPage] = useState(0);
  const dir = stage === "crop" ? "04_cropped" : "01_deduped";
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(page, pages - 1);
  const slice = items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {slice.map((it) => (
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
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-xs text-muted">
          <button
            onClick={() => setPage(p - 1)}
            disabled={p === 0}
            className="rounded px-2 py-1 enabled:hover:text-fg disabled:opacity-30"
          >
            ← Prev
          </button>
          <span>
            Page {p + 1} / {pages}
          </span>
          <button
            onClick={() => setPage(p + 1)}
            disabled={p >= pages - 1}
            className="rounded px-2 py-1 enabled:hover:text-fg disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
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
  initialSummary,
  onDone,
}: {
  projectId: string;
  index: number;
  stage: Stage;
  title: string;
  desc: string;
  enabled: boolean;
  initialSummary?: { total: number; kept: number };
  onDone?: () => void;
}) {
  const [state, setState] = useState<StageState>(initialSummary ? "done" : "idle");
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState(initialSummary);
  const [manifest, setManifest] = useState<EltManifest>();
  const [expanded, setExpanded] = useState(false);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [err, setErr] = useState<string>();

  async function run() {
    setState("running");
    setLines([]);
    setManifest(undefined);
    setExpanded(false);
    setErr(undefined);
    try {
      const { jobId } = await api.runElt(projectId, stage);
      const close = api.streamLogs(
        jobId,
        (line) => setLines((l) => [...l, line]),
        async (job) => {
          close();
          if (job.status !== "succeeded") {
            setState(job.status === "canceled" ? "idle" : "error");
            return;
          }
          try {
            const m = await api.getEltManifest(projectId, stage);
            setManifest(m);
            setSummary({ total: m.total, kept: m.kept });
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

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && !manifest) {
      setLoadingGrid(true);
      setErr(undefined);
      try {
        const m = await api.getEltManifest(projectId, stage);
        setManifest(m);
        setSummary({ total: m.total, kept: m.kept });
      } catch (e) {
        setErr(String(e));
        setExpanded(false);
      } finally {
        setLoadingGrid(false);
      }
    }
  }

  async function toggle(file: string, keep: boolean) {
    try {
      const m = await api.eltOverride(projectId, stage, file, keep);
      setManifest(m);
      setSummary({ total: m.total, kept: m.kept });
    } catch (e) {
      setErr(String(e));
    }
  }

  const summaryText = summary
    ? `${summary.kept} kept · ${summary.total - summary.kept} discarded`
    : undefined;

  return (
    <StageRow
      index={index}
      title={title}
      desc={desc}
      state={enabled ? state : "idle"}
      disabled={!enabled}
      summary={summaryText}
      action={
        <Button
          onClick={run}
          disabled={!enabled || state === "running"}
          variant={state === "done" ? "subtle" : "primary"}
        >
          {state === "running" ? "Running…" : state === "done" ? "Re-run" : "Run"}
        </Button>
      }
    >
      {(state === "running" || (lines.length > 0 && state !== "done")) && (
        <LogConsole lines={lines} className="mt-3 h-40" empty="Waiting for the GB10…" />
      )}
      {err && <div className="mt-2 text-xs text-err">{err}</div>}

      {state === "done" && summary && (
        <div className="mt-3">
          <button
            onClick={toggleExpand}
            className="text-xs text-muted transition hover:text-fg"
          >
            {expanded ? "▾" : "▸"} Review {summary.total} image
            {summary.total === 1 ? "" : "s"}
            {loadingGrid ? " · loading…" : ""}
          </button>
          {expanded && manifest && (
            <ReviewGrid
              projectId={projectId}
              stage={stage}
              items={manifest.items}
              onToggle={stage === "crop" ? undefined : toggle}
            />
          )}
        </div>
      )}
    </StageRow>
  );
}
