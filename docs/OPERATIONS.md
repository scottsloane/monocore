# MONOCORE — Operations

How to run, maintain, and troubleshoot the GB10 side. Local dev is in
[`INSTALL.md`](../INSTALL.md).

## Services on the GB10

| Service | What | How it runs |
|---------|------|-------------|
| **vLLM** | Qwen2.5-VL for quality/subject/crop/caption | `monocore-vllm` docker container (`~/llm-servers/run-vllm.sh`) |
| **Job API** | FastAPI job runner (`~/monocore/gb10-api`) | `uvicorn` on `127.0.0.1:8788` via `nohup` |
| **Trainer** | ai-toolkit image `monocore-trainer:latest` | one `docker run` per train/test job, as the host user |

All state lives under `~/monocore/` on the GB10:
```
~/monocore/gb10-api/      the job API (venv + code)
~/monocore/trainer/       train.py / generate.py (mounted into the trainer image)
~/monocore/projects/<id>/ per-project work/, dataset/, output/
~/.cache/huggingface/     base model weights (FLUX.1-dev, SDXL, …)
```

## Common tasks (run from the repo root, locally)

```bash
./scripts/gb10-setup.sh            # (re)deploy + restart the job API, verify /health
./scripts/gb10-install-trainer.sh  # (re)build the trainer image (after Dockerfile changes)
ssh gb10 'tail -f monocore/gb10-api/api.log'   # job API logs
```

Restart the job API by hand:
```bash
ssh gb10 'pkill -f "uvicorn app:app"; cd ~/monocore/gb10-api && \
  MONOCORE_GB10_PORT=8788 nohup ./.venv/bin/python -m uvicorn app:app \
  --host 127.0.0.1 --port 8788 > api.log 2>&1 &'
```

Check health (disk / GPU / models):
```bash
ssh gb10 'curl -s http://127.0.0.1:8788/health'
```

## Models

Base models are downloaded into the HF cache (as the host user):
```bash
ssh gb10 'HF_HUB_ENABLE_HF_TRANSFER=1 hf download black-forest-labs/FLUX.1-dev'
ssh gb10 'HF_HUB_ENABLE_HF_TRANSFER=1 hf download stabilityai/stable-diffusion-xl-base-1.0'
```
FLUX.1-dev is gated — accept the license on HF and put the token at
`~/.cache/huggingface/token` on the GB10.

## Jobs

- Jobs run **one at a time** through the job API's FIFO queue (no GPU contention).
- Cancel from the UI, or: `curl -X DELETE http://127.0.0.1:8788/jobs/<id>` (train/test
  containers are named `monocore-<job_id>` and are `docker kill`ed).
- List: `curl -s http://127.0.0.1:8788/jobs`.

## Gotchas

- **SSH goes quiet under heavy load.** Training a large model (esp. Flux
  unquantized) spikes load; the GB10 deprioritizes SSH and the NVIDIA dashboard.
  It is not stuck — it recovers when load drops. This is why Flux trains quantized.
- **Trainer file ownership.** The trainer runs `--user $(id -u):$(id -g)` so
  outputs are host-owned and deletable. If you ever get root-owned files from an
  older run: `ssh gb10 'docker run --rm -v ~/monocore:/w busybox chown -R 1000:1000 /w'`.
- **GPU memory shows `[N/A]`** in `nvidia-smi` — expected on the GB10's unified
  memory; use `free -g` for a memory picture.
- **Orphaned SSH tunnel** holding local port 8788: `pkill -f "8788:127.0.0.1:8788"`
  (the backend cleans up on exit, but a hard kill can leave one).

## Cleanup

```bash
# remove a project's files on the GB10 (host-owned, no root needed)
ssh gb10 'rm -rf monocore/projects/<id>'
# reclaim space: list HF cache sizes
ssh gb10 'du -sh ~/.cache/huggingface/hub/* | sort -h | tail'
```
