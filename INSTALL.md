# MONOCORE — Install & Run

MONOCORE is a desktop app (Tauri) with a local bun backend that drives a remote
NVIDIA **GB10** for the heavy work (vLLM inference, training, generation).
See `docs/ARCHITECTURE.md` for the design and `docs/PLAN.md` for the roadmap.

## Prerequisites

**Local machine**
- Rust toolchain (`cargo`) — https://rustup.rs
- `bun` (installer below handles this)
- Linux only: Tauri system deps
  ```
  sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev \
       libayatana-appindicator3-dev librsvg2-dev file
  ```
- SSH access to the GB10 as a host alias `gb10` (i.e. `ssh gb10` works).
  Override the alias with `MONOCORE_GB10_HOST`.

**GB10 (remote)**
- Python 3.12+, and the vLLM server running on `127.0.0.1:8000`
  (already provided by the `monocore-vllm` container).

## 1. Local setup

```bash
./scripts/dev-setup.sh
```
Installs `bun`, checks Rust/webkit, and installs JS deps for `apps/desktop`
and `apps/backend`.

## 2. Deploy the GB10 job API

```bash
./scripts/gb10-setup.sh
```
Syncs `services/gb10-api` to `~/monocore/gb10-api` on the GB10, creates a venv,
installs deps, (re)starts the API on `127.0.0.1:8788`, and verifies `/health`.

Tail remote logs: `ssh gb10 'tail -f monocore/gb10-api/api.log'`

## 3. Run

```bash
./scripts/dev.sh
```
Starts the backend (`http://localhost:8787`, which opens the SSH tunnel to the
GB10) and launches the desktop app. Click **Run no-op job** to confirm the full
round-trip: the job runs on the GB10 and its logs stream back live.

## Ports & env

| Var | Default | Meaning |
|-----|---------|---------|
| `MONOCORE_PORT` | `8787` | local backend HTTP/WS |
| `MONOCORE_GB10_HOST` | `gb10` | SSH host alias for the GB10 |
| `MONOCORE_GB10_PORT` | `8788` | job API port on the GB10 (localhost) |
| `MONOCORE_GB10_LOCAL_PORT` | `8788` | local end of the SSH tunnel |
| `MONOCORE_DATA_DIR` | `~/monocore-projects` | local projects + SQLite db |

## Troubleshooting

- **Status shows tunnel closed / API unreachable** — check `ssh gb10` works and
  that the job API is running (`./scripts/gb10-setup.sh` again).
- **Local port 8788 already in use** — a previous tunnel orphaned; the backend
  now cleans up on exit, but you can `pkill -f "8788:127.0.0.1:8788"`.
