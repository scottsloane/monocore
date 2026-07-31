# MONOCORE — Architecture

A three-tier system: a Tauri desktop app drives a local bun orchestrator, which
drives a remote job API on the GB10 for all heavy compute (vLLM inference,
ai-toolkit training, ComfyUI generation).

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  LOCAL (developer machine)  │        │  REMOTE (GB10 / ssh gb10)    │
│                             │        │  NVIDIA GB10, 128GB unified  │
│  ┌───────────────────────┐  │        │                              │
│  │ Tauri app (Rust shell)│  │        │  ┌────────────────────────┐  │
│  │  React+Vite+TS+Tail.  │  │        │  │ Job API (FastAPI)      │  │
│  │  dark UI              │  │        │  │  /jobs /status /logs   │  │
│  └──────────┬────────────┘  │        │  └───────┬────────────────┘  │
│             │ localhost HTTP/WS      │          │ spawns tracked    │
│  ┌──────────┴────────────┐  │  SSH   │          │ subprocesses      │
│  │ bun backend (sidecar) │──┼─tunnel─┼──► 8788  │                   │
│  │  projects, SQLite,    │  │  rsync │   ┌──────┴─────┬──────────┐  │
│  │  local ELT (prune/    │──┼────────┼──►│ vLLM       │ ai-toolkit│  │
│  │  dedupe), GB10 client │  │        │   │ (running,  │ ComfyUI   │  │
│  └───────────────────────┘  │        │   │ Qwen2.5-VL)│           │  │
│  ~/monocore-projects/<p>/   │        │   └────────────┴───────────┘  │
└─────────────────────────────┘        │   ~/monocore/<p>/            │
                                        └──────────────────────────────┘
```

## Tiers

### 1. Tauri desktop app (local)
- Tauri v2, Rust shell kept thin. Frontend: React + Vite + TypeScript + Tailwind,
  **dark mode only**, modern look. Heavy options hidden behind "Advanced" gates.
- Talks only to the local bun backend over `localhost` (HTTP + WebSocket for logs).
- Ships the bun backend as a Tauri sidecar binary.

### 2. bun backend (local orchestrator)
- Owns project lifecycle and the **local project folder** (source of truth for
  originals). Never modifies the user's selected input folder — copies out of it.
- State in **SQLite** (projects, stages, job ids, statuses).
- Runs the two cheap, local ELT stages so junk never gets uploaded:
  - **Prune** (min-dimension filter) and **Dedupe** (pHash) via `sharp`.
- Syncs the working set to the GB10 with `rsync` over SSH, submits jobs to the
  GB10 Job API through an SSH tunnel, and streams logs back to the UI.

### 3. GB10 Job API (remote)
- Python **FastAPI** service (Python 3.12 already present), binds `localhost:8788`
  on the GB10; reached only through an SSH `-L` tunnel opened by the bun backend.
- Runs each heavy stage as a tracked subprocess with captured logs and status:
  - **Quality / Subject / Caption** → the already-running **vLLM** (`Qwen2.5-VL-32B`).
  - **Crop** → subject-aware crop (vLLM bbox or detector).
  - **Train** → **ai-toolkit** (ostris) config-driven jobs, VRAM-aware.
  - **Test** → generation via **ComfyUI** (already cloned) or diffusers.
- All remote files live under `~/monocore/<project>/` (respects the "only touch
  `~/` on GB10" constraint).

## Project folder layout (local, mirrored on GB10)
```
<project>/
  project.json        # base model, training type, resolved settings, status
  source/             # copied originals — never modified
  work/
    00_pruned/  01_deduped/  02_quality/  03_subject/  04_cropped/  05_captioned/
  dataset/            # final image+caption pairs fed to the trainer
  output/             # LoRA/checkpoints + sample generations
  logs/
```

## ELT stage → where it runs
| # | Stage     | Runs on | Engine                         |
|---|-----------|---------|--------------------------------|
| 1 | Prune     | local   | sharp (min-dimension filter)   |
| 2 | Dedupe    | local   | pHash                          |
| 3 | Quality   | GB10    | vLLM (Qwen2.5-VL) ranking      |
| 4 | Subject   | GB10    | vLLM subject/aesthetic check   |
| 5 | Crop      | GB10    | subject-aware crop             |
| 6 | Caption   | GB10    | vLLM captioning                |
| 7 | Train     | GB10    | ai-toolkit (Flux/SDXL/Wan) LoRA or full |
| 8 | Test      | GB10    | diffusers AutoPipeline generation |

Quality/Subject each write a `manifest.json` (per-image score/match + keep flag)
and copy only kept images forward; the UI reviews them and can override keeps.
Train/Test run the `monocore-trainer` container **as the host user** (`--user`),
one at a time through the job API's FIFO queue.

## Job API surface
- Jobs: `POST /jobs {stage, project, params}` → `job_id` · `GET /jobs` ·
  `GET /jobs/{id}` · `GET /jobs/{id}/logs` (SSE) · `DELETE /jobs/{id}` (cancel).
- ELT: `GET /elt/manifest` · `POST /elt/override`.
- `GET /models` · `GET /health` (status, models, `disk_free_gb`, `gpu`).
- FIFO queue → one job at a time; jobs start `queued`. Cancel `docker kill`s
  train/test containers named `monocore-<job_id>`.

Backend (local) adds project CRUD (incl. **DELETE** → removes local + GB10 dirs),
per-stage runners, manual overrides, sample/artifact serving, and **LoRA export**
(`scp` a trained `.safetensors` to a local folder).

## Transport & security
- bun backend opens `ssh -L 8788:localhost:8788 gb10`; the API never binds a public
  interface. File movement via `rsync -az` / `scp` over the same SSH.
- Default-settings engine prefills all params from (base model × training type).
  **VRAM tuning:** SDXL LoRA trains unquantized at batch 4 (spends the 128GB);
  Flux stays quantized (unquantized Flux spikes load enough to starve SSH).
