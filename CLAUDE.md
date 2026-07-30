# MONOCORE — Agent rules

Flux/SDXL trainer with an image ETL pipeline and a desktop UI. Heavy compute runs
on a remote NVIDIA GB10. Read `PROJECT.md` for the product spec and
`docs/{ARCHITECTURE,PLAN,DECISIONS}.md` for the design, roadmap, and rationale.

## Operating mode — YOLO

Running with permissions bypassed, directly on the host (no VM/container). Act
autonomously; don't ask before routine work. Specifically:

- **Just do it**: create/edit/delete files in this repo, run builds, tests,
  linters, `bun`/`cargo`/`pip`, git commits, and `ssh gb10` commands without
  asking. Prefer acting over narrating.
- **Verify your own work** end-to-end before claiming done — drive the real flow
  (run the app / hit the endpoint / stream a job), not just typecheck. Fix what
  you find; report failures honestly with output.
- **Ask first only for**: destructive/irreversible actions with no undo
  (`git push --force`, deleting user data, dropping the vLLM/ComfyUI containers),
  anything outside the boundaries below, or a genuine product-direction fork.

## Hard boundaries (never cross)

- **Local**: only modify files inside this repo. Nothing elsewhere on the machine.
- **GB10**: only modify files under `~/` (specifically `~/monocore/`). Never touch
  system paths or other users' work.
- **Never modify a project's source images** — copy out of the selected input
  folder into the project folder; the source is read-only.
- Don't kill or reconfigure the running `monocore-vllm` container or ComfyUI
  without asking — other work depends on them.

## Workflow

- **Milestones**: commit AND push at every milestone (per `PROJECT.md`). Work on a
  branch off `main`; end commit messages with the Co-Authored-By trailer.
- Keep `README.md` current at milestones; record decisions in `docs/DECISIONS.md`
  and architecture changes in `docs/ARCHITECTURE.md`.
- Reusable setup/ops logic goes in `scripts/`; remote work goes through
  `./scripts/gb10-*.sh` where possible.
- Minimize token usage; compact/clear context often. Prefer editing the deploy
  script over re-typing ad-hoc `ssh` one-liners.

## Product conventions

- **UI**: dark mode only; modern and clean. Minimize visible options — hide extras
  behind "Advanced" gates.
- **Projects**: every project gets its own folder holding all its files + settings.
- **Defaults**: prefill all settings from (base model × training type) as a best
  guess; the user tweaks only when needed.
- **VRAM**: exploit the GB10's ~128GB where it helps.
- Base models to support: SDXL, Flux, Wan, … · Training types: subject, aesthetic,
  person, face. Trainer engine: **ai-toolkit**.

## Reference

- Ports: backend `8787` · GB10 job API `8788` (localhost, via SSH tunnel) ·
  vLLM `8000` (on GB10).
- Layout: `apps/desktop` (Tauri) · `apps/backend` (bun) · `services/gb10-api`
  (FastAPI) · `scripts/` · `docs/`.
- Run locally: `./scripts/dev.sh`. Deploy GB10 API: `./scripts/gb10-setup.sh`.
