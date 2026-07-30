# MONOCORE

A Flux/SDXL trainer with a full image **ETL pipeline** and a modern desktop UI.
It prepares an image dataset (prune → dedupe → quality → subject → crop → caption),
trains a model on a remote **NVIDIA GB10**, and tests it with generation.

> Status: **M3 — training depth & multi-model complete.** Trains **Flux and SDXL**
> (Wan wired) as **LoRA or full fine-tune**, with **VRAM auto-tuning** for the
> GB10's ~128GB, **in-training samples**, a **job queue** (one job at a time), and
> **cancel**. On top of the full M2 ELT pipeline (prune → dedupe → quality →
> subject → crop → caption → train → test) with per-stage review + overrides.
> Verified: SDXL and Flux LoRAs trained on the GB10 and used for test generation.
> Next: **M4**, dashboard, artifact browser, hardening. See
> [`docs/PLAN.md`](docs/PLAN.md).

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
