"""Shared vLLM (Qwen2.5-VL) helpers for the ELT stages."""
from __future__ import annotations

import base64
import json
import mimetypes
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable

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


def map_concurrent(
    items: list,
    worker: Callable,
    workers: int = 8,
    on_progress: Callable[[int, int, object], None] | None = None,
) -> list:
    """Run ``worker(item)`` over ``items`` with bounded concurrency.

    vLLM serves concurrent requests via continuous batching, so firing several at
    once is far faster than a serial loop. Results are returned in input order;
    ``on_progress(completed, total, result)`` fires as each finishes (main thread).
    Workers must catch their own errors and return a result (never raise).
    """
    n = len(items)
    results: list = [None] * n
    if n == 0:
        return results
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        futs = {ex.submit(worker, it): i for i, it in enumerate(items)}
        completed = 0
        for fut in as_completed(futs):
            i = futs[fut]
            results[i] = fut.result()
            completed += 1
            if on_progress:
                on_progress(completed, n, results[i])
    return results
