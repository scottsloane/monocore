"""Shared vLLM (Qwen2.5-VL) helpers for the ELT stages."""
from __future__ import annotations

import base64
import json
import mimetypes
import re

import httpx

DEFAULT_MODEL = "Qwen/Qwen2.5-VL-32B-Instruct-AWQ"
DEFAULT_URL = "http://127.0.0.1:8000"


def data_uri(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode()


def ask(
    client: httpx.Client,
    prompt: str,
    image_path: str,
    *,
    model: str = DEFAULT_MODEL,
    vllm: str = DEFAULT_URL,
    max_tokens: int = 300,
    temperature: float = 0.1,
    json_mode: bool = False,
) -> str:
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_uri(image_path)}},
                ],
            }
        ],
    }
    if json_mode:
        # Force a JSON object from the first token (vLLM guided decoding), so the
        # model can't ramble past max_tokens before emitting the answer.
        body["response_format"] = {"type": "json_object"}
    resp = client.post(f"{vllm}/v1/chat/completions", json=body)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of a model response (tolerant of prose/fences)."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"no JSON object in response: {text[:160]!r}")
    return json.loads(m.group(0))
