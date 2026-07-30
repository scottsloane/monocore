# MONOCORE

A Flux/SDXL trainer with a full image **ETL pipeline** and a modern desktop UI.
It prepares an image dataset (prune → dedupe → quality → subject → crop → caption),
trains a model on a remote **NVIDIA GB10**, and tests it with generation.

> Status: **M0 — scaffolding complete.** The app shell, local orchestrator, and
> GB10 job API are wired end-to-end (no-op job round-trips with live logs).
> Next: **M1**, the end-to-end thin slice (real images → Flux LoRA → test gen).
> See [`docs/PLAN.md`](docs/PLAN.md).

## Architecture (short)

```
Tauri desktop app ─▶ bun backend (local) ─ssh tunnel─▶ GB10 job API (FastAPI)
   dark React UI      SQLite, orchestration            vLLM · ai-toolkit · ComfyUI
```

Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Layout

```
apps/desktop/       Tauri v2 app — React + Vite + TS + Tailwind (dark only)
apps/backend/       bun orchestrator — SSH tunnel, SQLite, job proxy
services/gb10-api/  FastAPI job API that runs on the GB10
scripts/            dev-setup, gb10-setup, dev runners
docs/               architecture, plan, decisions
```

## Quickstart

```bash
./scripts/dev-setup.sh     # local deps (bun, JS)
./scripts/gb10-setup.sh    # deploy job API to the GB10
./scripts/dev.sh           # run backend + desktop app
```

See [`INSTALL.md`](INSTALL.md) for details and prerequisites.
