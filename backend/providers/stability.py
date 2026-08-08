from __future__ import annotations

"""Stability AI (Stable Image) provider.

Stability doesn't offer a general-purpose text/chat API, so prompt expansion is
delegated to another provider -- the same "mixed" pattern as providers.local (Ollama
for text, ComfyUI for images). Which one is configurable via STABILITY_TEXT_PROVIDER
(default "local"/Ollama, so this provider needs no extra cloud API key for the text
step by default); set it to "gemini" or "openai" to use a different text backend
instead.

CAVEAT: the image-to-image (finalize) request shape below (mode/strength on the sd3
endpoint) was written from documented parameter names (AWS Bedrock's mirror of the
Stability API, which spells them out) but NOT verified against a live call --
Stability's own docs page is a JS-rendered SPA that couldn't be fetched at
implementation time. Verify against https://platform.stability.ai/docs/api-reference
before relying on this in production.
"""

import asyncio
import os

import httpx

from providers import gemini as gemini_provider
from providers import local as local_provider
from providers import openai as openai_provider
from providers._storage import BACKEND_ROOT, save_image_bytes
from providers.prompts import NEGATIVE_PROMPT

STABILITY_API_KEY = os.environ.get("STABILITY_API_KEY", "")
STABILITY_TEXT_PROVIDER = os.environ.get("STABILITY_TEXT_PROVIDER", "local")
_TEXT_PROVIDERS = {"gemini": gemini_provider, "local": local_provider, "openai": openai_provider}
STABILITY_BASE_URL = os.environ.get("STABILITY_BASE_URL", "https://api.stability.ai")
# Core is cheap/fast, used for the 4 previews. sd3 is the endpoint documented to
# support image-to-image (mode/strength), used for finalize.
STABILITY_PREVIEW_ENDPOINT = os.environ.get(
    "STABILITY_PREVIEW_ENDPOINT", "/v2beta/stable-image/generate/core"
)
STABILITY_FINAL_ENDPOINT = os.environ.get(
    "STABILITY_FINAL_ENDPOINT", "/v2beta/stable-image/generate/sd3"
)
STABILITY_FINAL_STRENGTH = os.environ.get("STABILITY_FINAL_STRENGTH", "0.35")
# Only the 4K finalize targets this aspect ratio -- previews omit aspect_ratio
# entirely and rely on the Core endpoint's own default (square), matching the source
# images previews are meant to look like.
STABILITY_ASPECT_RATIO = os.environ.get("STABILITY_ASPECT_RATIO", "16:9")

PREVIEW_COUNT = 4

_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0),
            headers={"Authorization": f"Bearer {STABILITY_API_KEY}", "Accept": "image/*"},
        )
    return _http_client


async def expand_prompt(user_prompt: str) -> str:
    text_provider = _TEXT_PROVIDERS.get(STABILITY_TEXT_PROVIDER, local_provider)
    return await text_provider.expand_prompt(user_prompt)


async def _generate_one_preview(client: httpx.AsyncClient, enhanced_prompt: str) -> str | None:
    try:
        response = await client.post(
            f"{STABILITY_BASE_URL}{STABILITY_PREVIEW_ENDPOINT}",
            # Stability's v2beta endpoints expect multipart/form-data even for
            # text-only requests; (None, value) tuples force httpx to encode plain
            # fields as multipart instead of defaulting to urlencoded.
            files={
                "prompt": (None, enhanced_prompt),
                "negative_prompt": (None, NEGATIVE_PROMPT),
                "output_format": (None, "png"),
            },
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None
    content_type = response.headers.get("content-type") or "image/png"
    return save_image_bytes(response.content, content_type)


async def generate_preview_batch(enhanced_prompt: str) -> list[str | None]:
    """4 independent parallel calls, like providers.gemini -- Stability's generate
    endpoints return one image per call, no native batch/n parameter."""
    client = _get_http_client()
    tasks = [_generate_one_preview(client, enhanced_prompt) for _ in range(PREVIEW_COUNT)]
    return await asyncio.gather(*tasks)


async def generate_final_image(enhanced_prompt: str, reference_image_path: str) -> str | None:
    client = _get_http_client()
    reference_path = BACKEND_ROOT / reference_image_path.lstrip("/")

    try:
        response = await client.post(
            f"{STABILITY_BASE_URL}{STABILITY_FINAL_ENDPOINT}",
            files={
                "image": (reference_path.name, reference_path.read_bytes(), "image/png"),
                "prompt": (None, enhanced_prompt),
                "negative_prompt": (None, NEGATIVE_PROMPT),
                "mode": (None, "image-to-image"),
                "strength": (None, STABILITY_FINAL_STRENGTH),
                # The reference image is square (preview's aspect ratio) while this
                # targets 16:9, so this field is what's actually responsible for the
                # aspect-ratio change -- unverified whether sd3 image-to-image applies
                # it as a crop/reframe or something else; see module docstring.
                "aspect_ratio": (None, STABILITY_ASPECT_RATIO),
                "output_format": (None, "png"),
            },
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None
    content_type = response.headers.get("content-type") or "image/png"
    return save_image_bytes(response.content, content_type)
