# MONOCORE trainer image — ai-toolkit on top of NVIDIA's aarch64/Blackwell torch.
# The base image already ships a working torch (sm_121 / CUDA 13.2). ai-toolkit's
# requirements don't pin torch, so a normal install won't replace it; we also pin
# the torch stack via a constraints file so no transitive dep upgrades it.
FROM nvcr.io/nvidia/pytorch:26.04-py3

RUN git clone --depth 1 --recurse-submodules \
    https://github.com/ostris/ai-toolkit /opt/ai-toolkit

WORKDIR /opt/ai-toolkit
# Pin the container's torch stack so no transitive dep upgrades it.
RUN pip freeze | grep -iE '^(torch|torchvision|torchaudio)==' \
      > /opt/torch-constraints.txt || true
# Flatten ai-toolkit's requirements (requirements.txt just `-r`s the base file),
# and drop `torchcodec` — a video-only dep with no wheel for this torch build.
RUN cat requirements_base.txt requirements.txt \
      | grep -vE '^\s*-r\s' \
      | grep -viE '^torchcodec' \
      > /opt/monocore-req.txt \
    && PIP_CONSTRAINT=/opt/torch-constraints.txt \
       pip install --no-cache-dir -r /opt/monocore-req.txt

# opencv (pulled by ai-toolkit) needs libGL/glib at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Stub torchaudio (no wheel for this nv-torch; only audio models use it).
COPY torchaudio_stub.py \
    /usr/local/lib/python3.12/dist-packages/torchaudio.py

ENV HF_HOME=/root/.cache/huggingface \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace
