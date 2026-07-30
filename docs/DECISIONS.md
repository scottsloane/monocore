# MONOCORE — Decisions (ADR log)

Short, dated records of load-bearing choices. Newest first.

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
