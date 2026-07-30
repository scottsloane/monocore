"""Stub `torchaudio` for the image-only MONOCORE trainer.

The NVIDIA nv-torch build in this container has no matching torchaudio wheel, and
ai-toolkit imports torchaudio unconditionally in config_modules.py even though it
is only *used* by audio models (AceStep, LTX2) — never in the Flux/SDXL image
LoRA path. This stub satisfies the import; any actual audio call raises clearly.
"""


class _Stub:
    def __getattr__(self, name):
        return _Stub()

    def __call__(self, *args, **kwargs):
        raise RuntimeError(
            "torchaudio is stubbed in monocore-trainer (image training only)"
        )


functional = _Stub()
transforms = _Stub()


def save(*args, **kwargs):
    raise RuntimeError("torchaudio is stubbed in monocore-trainer (image only)")


def load(*args, **kwargs):
    raise RuntimeError("torchaudio is stubbed in monocore-trainer (image only)")
