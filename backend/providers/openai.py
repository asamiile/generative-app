from __future__ import annotations

"""OpenAI image generation provider (GPT Image + chat completions for prompt expansion).

CAVEAT: model IDs/params below were confirmed against https://developers.openai.com
docs at implementation time (2026-08-08), but OpenAI's chat-model naming especially
changes fast -- verify OPENAI_TEXT_MODEL against
https://platform.openai.com/docs/models and OPENAI_IMAGE_MODEL against
https://platform.openai.com/docs/guides/image-generation before relying on this in
production (same spirit as AGENTS.md's Gemini model-freshness rule, generalized to
every provider now that there's more than one).
"""

import base64
import os

import httpx

from providers._http import request_with_retry
from providers._storage import BACKEND_ROOT, save_image_bytes
from providers.prompts import NEGATIVE_PROMPT, SYSTEM_PROMPT

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_TEXT_MODEL = os.environ.get("OPENAI_TEXT_MODEL", "gpt-5-mini")
OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
# Preview stays square (one of the 3 documented standard sizes), matching the source
# images previews are meant to look like. Only the 4K finalize targets 16:9: not one
# of the 3 documented standard sizes (1024x1024, 1536x1024, 1024x1536), but both dims
# are multiples of 16 and the ratio is within the documented 1:3-3:1 custom-size range
# -- if the API rejects it, fall back to the standard 1536x1024 (3:2, the closest
# official landscape size).
OPENAI_PREVIEW_SIZE = os.environ.get("OPENAI_PREVIEW_SIZE", "1024x1024")
OPENAI_FINAL_SIZE = os.environ.get("OPENAI_FINAL_SIZE", "2048x1152")

PREVIEW_COUNT = 4

_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0),
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        )
    return _http_client


async def expand_prompt(user_prompt: str) -> str:
    client = _get_http_client()
    response = await request_with_retry(
        lambda: client.post(
            f"{OPENAI_BASE_URL}/chat/completions",
            json={
                "model": OPENAI_TEXT_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    # Treat user input as data, not instructions (prompt injection
                    # defense), matching providers/gemini.py and providers/local.py.
                    {"role": "user", "content": f'User input: """{user_prompt}"""'},
                ],
            },
        )
    )
    # Left uncaught -- main.py wraps the expand_prompt call for every provider and
    # turns any exception into a clean 502 instead of session creation failing silently.
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


def _negative_prompt_suffix() -> str:
    # The Images API has no dedicated negative_prompt field (unlike Stability/SD),
    # so photorealism is reinforced via prompt phrasing instead.
    return f"\nAvoid: {NEGATIVE_PROMPT}."


async def _generate_previews(enhanced_prompt: str, n: int) -> list[str | None]:
    client = _get_http_client()
    try:
        response = await request_with_retry(
            lambda: client.post(
                f"{OPENAI_BASE_URL}/images/generations",
                json={
                    "model": OPENAI_IMAGE_MODEL,
                    "prompt": enhanced_prompt + _negative_prompt_suffix(),
                    "n": n,
                    "size": OPENAI_PREVIEW_SIZE,
                },
            )
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return [None] * n

    items = response.json().get("data", [])
    paths: list[str | None] = []
    for item in items[:n]:
        b64 = item.get("b64_json")
        if not b64:
            paths.append(None)
            continue
        paths.append(save_image_bytes(base64.b64decode(b64), "image/png"))
    while len(paths) < n:
        paths.append(None)
    return paths


async def generate_preview_batch(enhanced_prompt: str) -> list[str | None]:
    """Generate all 4 previews in a single call: unlike Gemini, the Images API
    supports n>1 (multiple candidates per request) natively."""
    return await _generate_previews(enhanced_prompt, PREVIEW_COUNT)


async def generate_one_preview(enhanced_prompt: str) -> str | None:
    """Public single-image entry point (used by the individual-retry endpoint) --
    same /images/generations call as generate_preview_batch, just n=1."""
    results = await _generate_previews(enhanced_prompt, 1)
    return results[0] if results else None


async def generate_final_image(enhanced_prompt: str, reference_image_path: str) -> str | None:
    client = _get_http_client()
    reference_path = BACKEND_ROOT / reference_image_path.lstrip("/")

    try:
        response = await request_with_retry(
            lambda: client.post(
                f"{OPENAI_BASE_URL}/images/edits",
                data={
                    "model": OPENAI_IMAGE_MODEL,
                    "prompt": enhanced_prompt + _negative_prompt_suffix(),
                    "size": OPENAI_FINAL_SIZE,
                    "n": "1",
                },
                files={"image": (reference_path.name, reference_path.read_bytes(), "image/png")},
            )
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None

    items = response.json().get("data", [])
    if not items or not items[0].get("b64_json"):
        return None
    return save_image_bytes(base64.b64decode(items[0]["b64_json"]), "image/png")
