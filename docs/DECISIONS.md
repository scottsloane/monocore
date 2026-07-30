# MONOCORE — Decisions (ADR log)

Short, dated records of load-bearing choices. Newest first.

## 2026-07-30 — Trainer runs containerized (NGC PyTorch)
- ai-toolkit runs inside `nvcr.io/nvidia/pytorch:26.04-py3` (docker, no sudo —
  user is in the `docker` group), **not** a bare-metal venv.
- **Why:** the GB10 is Blackwell **sm_121** on **aarch64**; there is no easy
  pip torch wheel for that target. The NGC container ships a working
  torch 2.12 / CUDA 13.2 build (confirmed via the running vLLM container).
  Mirrors the existing containerized vLLM setup.
- ai-toolkit deps install **on top of** the container's torch/torchvision
  (do not let pip reinstall torch). Model weights + project data mount from
  `~/monocore/<project>`.

## 2026-07-30 — Initial architecture decisions
- **Trainer engine: ai-toolkit (ostris).** Flux-first, modern, config-driven jobs
  with good LoRA + full fine-tune support; SDXL/Wan added later. Alternatives
  (kohya sd-scripts, SimpleTuner) kept as fallbacks if ARM64/Blackwell build issues arise.
- **GB10 control plane: a Job API server on the GB10**, not direct `ssh` exec.
  Gives durable long-running jobs, live log streaming, restart-survivable status,
  and a clean contract. FastAPI (Python already present, matches vLLM ecosystem).
- **First milestone: end-to-end thin slice.** Prove the whole pipeline
  (create → copy → prune/dedupe → caption → tiny LoRA → test gen) before deepening
  any single stage.
- **Cheap ELT (prune, dedupe) runs locally** in the bun backend so junk never
  uploads; everything needing vLLM/GPU runs on the GB10.
- **Frontend: React + Vite + TS + Tailwind** inside Tauri v2, dark-only.
- **State: SQLite** in the local bun backend.

## Environment facts (as of 2026-07-30)
- GB10: NVIDIA GB10, ARM64 Ubuntu, ~121GB unified mem, 2.9TB free, Docker present,
  no `uv`/`bun`. vLLM already running (`monocore-vllm` container) serving
  `Qwen/Qwen2.5-VL-32B-Instruct-AWQ`. ComfyUI already cloned in `~/github`.
- Local: Rust/cargo ✅, Node/npm ✅. **Missing: `bun`, Tauri CLI** (install in M0).
- Repo: github.com/scottsloane/monocore.
