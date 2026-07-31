import { useEffect, useState } from "react";
import { api, type Health, type Project } from "./api";
import { Dot, Card, Button, Badge } from "./ui";
import { CreateWizard } from "./views/CreateWizard";
import { ProjectView } from "./views/ProjectView";

function StatusPill({ health }: { health?: Health }) {
  const gb10 = health?.gb10;
  const ok = gb10?.reachable;
  const gpuName = gb10?.gpu?.split(",")[0]?.trim();
  return (
    <div className="flex items-center gap-3 rounded-full border border-border bg-panel px-3 py-1.5 text-xs">
      <span className="flex items-center gap-2">
        <Dot ok={health ? ok : undefined} />
        <span className="text-muted">
          {!health
            ? "backend offline"
            : ok
              ? "GB10 connected"
              : gb10?.tunnel
                ? "GB10 unreachable"
                : "tunnel down"}
        </span>
      </span>
      {ok && gpuName && (
        <span className="hidden text-muted/70 sm:inline">· {gpuName}</span>
      )}
      {ok && gb10?.diskFreeGb != null && (
        <span className="hidden text-muted/70 sm:inline">
          · {gb10.diskFreeGb >= 1000
            ? `${(gb10.diskFreeGb / 1000).toFixed(1)}TB`
            : `${gb10.diskFreeGb}GB`}{" "}
          free
        </span>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Card className="group relative p-5 transition hover:border-accent/50">
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-fg">{project.name}</h3>
          <Badge tone="accent">{project.baseModel}</Badge>
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted">
          <Badge>{project.trainType}</Badge>
          <span>· {project.source.imageCount} images</span>
        </div>
        <div className="mt-3 text-xs text-muted/60">stage: {project.status}</div>
      </button>
      {confirm ? (
        <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs">
          <span className="text-muted">Delete?</span>
          <button onClick={onDelete} className="text-err hover:underline">
            Yes
          </button>
          <button onClick={() => setConfirm(false)} className="text-muted hover:underline">
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          className="absolute right-3 bottom-3 text-xs text-muted/40 opacity-0 transition hover:text-err group-hover:opacity-100"
          title="Delete project"
        >
          Delete
        </button>
      )}
    </Card>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [wizard, setWizard] = useState(false);
  const [openId, setOpenId] = useState<string>();

  async function refreshHealth() {
    try {
      setHealth(await api.health());
    } catch {
      setHealth(undefined);
    }
  }
  async function refreshProjects() {
    try {
      setProjects((await api.listProjects()).projects);
    } catch {
      /* backend may be starting */
    }
  }

  useEffect(() => {
    refreshHealth();
    refreshProjects();
    const t = setInterval(refreshHealth, 5000);
    return () => clearInterval(t);
  }, []);

  const openProject = projects.find((p) => p.id === openId);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-8 py-10">
      <header className="flex items-center justify-between">
        <button
          onClick={() => setOpenId(undefined)}
          className="text-left"
        >
          <h1 className="bg-gradient-to-r from-accent-2 to-accent bg-clip-text text-2xl font-bold tracking-tight text-transparent">
            MONOCORE
          </h1>
          <p className="mt-0.5 text-xs text-muted">Flux trainer · GB10 pipeline</p>
        </button>
        <StatusPill health={health} />
      </header>

      {openProject ? (
        <ProjectView
          project={openProject}
          onBack={() => {
            setOpenId(undefined);
            refreshProjects();
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
              Projects
            </h2>
            <Button variant="primary" onClick={() => setWizard(true)}>
              + New project
            </Button>
          </div>

          {projects.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 p-12 text-center">
              <p className="text-muted">No projects yet.</p>
              <Button variant="primary" onClick={() => setWizard(true)}>
                Create your first project
              </Button>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onOpen={() => setOpenId(p.id)}
                  onDelete={async () => {
                    setProjects((prev) => prev.filter((x) => x.id !== p.id));
                    try {
                      await api.deleteProject(p.id);
                    } catch {
                      refreshProjects();
                    }
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {wizard && (
        <CreateWizard
          onCancel={() => setWizard(false)}
          onCreated={(p) => {
            setWizard(false);
            setProjects((prev) => [p, ...prev]);
            setOpenId(p.id);
          }}
        />
      )}

      <footer className="mt-auto text-center text-xs text-muted/50">
        M4 · see docs/PLAN.md
      </footer>
    </div>
  );
}
