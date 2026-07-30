import { useEffect, useRef, useState } from "react";
import { api, type Health, type Job } from "./api";

function Dot({ ok }: { ok: boolean | undefined }) {
  const color = ok === undefined ? "bg-muted" : ok ? "bg-ok" : "bg-err";
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${color} shadow-[0_0_8px] shadow-current`} />
  );
}

function StatusCard({ health, loading }: { health?: Health; loading: boolean }) {
  const gb10 = health?.gb10;
  return (
    <div className="rounded-2xl border border-border bg-panel/80 p-5 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">System</h2>
        {loading && <span className="text-xs text-muted">checking…</span>}
      </div>
      <ul className="space-y-3 text-sm">
        <li className="flex items-center gap-3">
          <Dot ok={health ? true : undefined} />
          <span className="text-fg">Local backend</span>
          <span className="ml-auto font-mono text-xs text-muted">
            {health ? `v${health.version}` : "—"}
          </span>
        </li>
        <li className="flex items-center gap-3">
          <Dot ok={gb10?.tunnel} />
          <span className="text-fg">GB10 SSH tunnel</span>
          <span className="ml-auto font-mono text-xs text-muted">
            {gb10?.tunnel ? "open" : "closed"}
          </span>
        </li>
        <li className="flex items-center gap-3">
          <Dot ok={gb10?.reachable} />
          <span className="text-fg">GB10 job API</span>
          <span className="ml-auto font-mono text-xs text-muted">
            {gb10?.reachable ? "reachable" : gb10?.error ?? "—"}
          </span>
        </li>
        <li className="flex items-start gap-3">
          <Dot ok={gb10?.models?.length ? true : undefined} />
          <span className="text-fg">vLLM models</span>
          <span className="ml-auto max-w-[60%] text-right font-mono text-xs text-muted">
            {gb10?.models?.length ? gb10.models.join(", ") : "—"}
          </span>
        </li>
      </ul>
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health>();
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  const [job, setJob] = useState<Job>();
  const [running, setRunning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      setHealth(await api.health());
    } catch {
      setHealth(undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [lines]);

  async function runNoop() {
    setLines([]);
    setJob(undefined);
    setRunning(true);
    try {
      const { jobId } = await api.runNoop();
      const close = api.streamLogs(
        jobId,
        (line) => setLines((l) => [...l, line]),
        (j) => {
          setJob(j);
          setRunning(false);
          close();
        },
      );
    } catch (e) {
      setLines((l) => [...l, `error: ${String(e)}`]);
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-8 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="bg-gradient-to-r from-accent-2 to-accent bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            MONOCORE
          </h1>
          <p className="mt-1 text-sm text-muted">Flux trainer · GB10 pipeline</p>
        </div>
        <button
          onClick={refresh}
          className="rounded-lg border border-border bg-panel px-3 py-1.5 text-xs text-muted transition hover:text-fg"
        >
          Refresh
        </button>
      </header>

      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <StatusCard health={health} loading={loading} />

        <div className="flex flex-col rounded-2xl border border-border bg-panel/80 p-5 backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
              Connectivity check
            </h2>
            <button
              onClick={runNoop}
              disabled={running || !health?.gb10.reachable}
              className="rounded-lg bg-gradient-to-r from-accent to-accent-2 px-4 py-1.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Running…" : "Run no-op job"}
            </button>
          </div>
          <div
            ref={logRef}
            className="h-64 overflow-auto rounded-lg border border-border bg-bg/60 p-3 font-mono text-xs leading-relaxed text-muted"
          >
            {lines.length === 0 ? (
              <span className="text-muted/50">
                Runs a no-op job on the GB10 and streams its logs back — proves the full
                round-trip.
              </span>
            ) : (
              lines.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap text-fg/90">
                  {l}
                </div>
              ))
            )}
          </div>
          {job && (
            <div className="mt-3 text-xs">
              <span
                className={
                  job.status === "succeeded"
                    ? "text-ok"
                    : job.status === "failed"
                      ? "text-err"
                      : "text-muted"
                }
              >
                ● {job.status}
              </span>
              <span className="ml-2 font-mono text-muted">exit {job.exitCode ?? "—"}</span>
            </div>
          )}
        </div>
      </div>

      <footer className="mt-auto text-center text-xs text-muted/50">
        M0 · scaffolding — see docs/PLAN.md
      </footer>
    </div>
  );
}
