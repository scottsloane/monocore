# MONOCORE — Build Plan

Phased roadmap. Each milestone ends with a commit + push and (where relevant) a
README/INSTALL update, per PROJECT.md. See `ARCHITECTURE.md` and `DECISIONS.md`.

## M0 — Scaffolding & infrastructure
Goal: an empty but wired app that can reach the GB10 and run a no-op job.
- Install toolchain: `bun`, Tauri v2 CLI locally (`scripts/dev-setup.sh`).
- Tauri v2 app shell (React + Vite + TS + Tailwind, dark-only) + bun backend sidecar.
- SQLite project store; project model (`project.json` schema).
- GB10 setup script (`scripts/gb10-setup.sh`): install ai-toolkit, confirm vLLM +
  ComfyUI, create `~/monocore/`, install the Job API service (systemd or docker).
- Job API skeleton (FastAPI): `/health`, `/jobs` (echo job), SSE `/jobs/{id}/logs`.
- bun backend opens the SSH tunnel and round-trips a no-op job end to end.
- `INSTALL.md`, `README.md` stub, `docs/` in place.
- **Milestone commit.**

## M1 — End-to-end thin slice ← first real deliverable
Goal: one Flux subject LoRA produced from real images through the whole pipeline.
- Project-create wizard: name, base model (Flux), training type (subject).
  Creates the local project folder; copies images from a selected input folder
  into `source/` (source folder never modified).
- **Prune** (min dimension) + **Dedupe** (pHash) locally → `work/00,01`.
- `rsync` working set to `~/monocore/<project>/` on GB10.
- **Caption** job via vLLM (Qwen2.5-VL) → `work/05_captioned` + `dataset/`.
- **Train** job: ai-toolkit Flux LoRA, small/quick config, VRAM-aware.
- **Test** job: generate samples with the trained LoRA → `output/`.
- UI: stage progress + live logs (WS), final sample gallery.
- **Milestone commit** + README/INSTALL update.

## M2 — Full ELT quality
- **Quality** ranking, **Subject/aesthetic** check, **Crop** (subject-aware) jobs.
- Per-stage review UI: thumbnails, accept/reject, counts, before/after.
- Default-settings engine: prefill all params from (base model × training type).
- Advanced-options gating across the UI.
- **Milestone commit.**

## M3 — Training depth & multi-model
- Base models: SDXL, Flux, Wan (+ others). Training types: subject, aesthetic,
  person, face — each a preset bundle of defaults.
- LoRA vs full fine-tune; VRAM auto-tuning to exploit ~128GB.
- In-training sample images; cancel/resume; job queue.
- **Milestone commit.**

## M4 — Polish & hardening
- Project dashboard, artifact browser, model export/versioning.
- Robust error handling, retries, disk/space guards, GB10 health checks.
- Finalize `docs/ARCHITECTURE.md`; write `docs/OPERATIONS.md`.
- **Milestone commit.**

## Cross-cutting conventions
- Reusable scripts live in `scripts/`; remote setup/maintenance via `ssh gb10`.
- Only modify files inside this repo (local) and under `~/` on the GB10.
- Keep context compact; commit at every milestone.
