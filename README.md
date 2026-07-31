# MONOCORE

A Flux/SDXL trainer with a full image **ETL pipeline** and a modern desktop UI.
It prepares an image dataset (prune → dedupe → quality → subject → crop → caption),
trains a model on a remote **NVIDIA GB10**, and tests it with generation.

> Status: **M4 — polish & hardening complete.** Adds **project delete** (local +
> GB10), an **artifact browser + LoRA export**, richer **GB10 health** (disk / GPU
> in the UI), and a key fix: the **trainer runs as the host user** so its outputs
> are owned/manageable without root. On top of the full pipeline (prune → dedupe →
> quality → subject → crop → caption → train → test) trained for **Flux & SDXL**
> (LoRA/full), with review overrides, a job queue, and cancel.
> Ops guide: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

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
apps/backend/       bun orchestrator — SSH tunnel, SQLite, job proxy, local ELT
services/gb10-api/  FastAPI job API that runs on the GB10 (caption/train/test)
services/trainer/   ai-toolkit trainer image (Docker) + train/test scripts
scripts/            dev-setup, gb10-setup, gb10-install-trainer, dev runners
docs/               architecture, plan, decisions
```

## Quickstart

```bash
./scripts/dev-setup.sh            # local deps (bun, JS)
./scripts/gb10-setup.sh           # deploy job API to the GB10
./scripts/gb10-install-trainer.sh # build the ai-toolkit trainer image on the GB10
./scripts/dev.sh                  # run backend + desktop app
```

Training FLUX.1-dev requires HuggingFace access: accept the license, then place
your token on the GB10 at `~/.cache/huggingface/token`.

See [`INSTALL.md`](INSTALL.md) for details and prerequisites.
