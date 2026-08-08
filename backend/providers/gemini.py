from __future__ import annotations

import asyncio
import mimetypes
import os

from google import genai
from google.genai import errors, types

from providers._storage import BACKEND_ROOT, save_image_bytes
from providers.prompts import SYSTEM_PROMPT

TEXT_MODEL = "gemini-3.6-flash"
IMAGE_MODEL = "gemini-3-pro-image"
PREVIEW_COUNT = 4
# Only the 4K finalize targets this aspect ratio -- previews are left at the model's
# default (square), matching the source images previews are meant to look like.
# gemini-3-pro-image's image_config.aspect_ratio accepts "16:9" directly (confirmed
# against docs 2026-08-09).
IMAGE_ASPECT_RATIO = os.environ.get("GEMINI_ASPECT_RATIO", "16:9")
# gemini-3-pro-image is high demand and can return 503 UNAVAILABLE, so retry with short backoff.
IMAGE_RETRY_DELAYS_SECONDS = (2, 5, 10)

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


async def expand_prompt(user_prompt: str) -> str:
    client = _get_client()
    response = await client.aio.models.generate_content(
        model=TEXT_MODEL,
        # Treat user input as data, not instructions (prompt injection defense).
        contents=f'User input: """{user_prompt}"""',
        config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
    )
    return response.text.strip()


def _extract_image_part(response: types.GenerateContentResponse) -> tuple[bytes, str] | None:
    """Extract the image bytes and actual MIME type from the response.

    Gemini's image models can return JPEG even when PNG was requested, so the file
    extension is decided from the response's mime_type rather than fixed.
    """
    for candidate in response.candidates or []:
        for part in candidate.content.parts or []:
            if part.inline_data is not None:
                mime_type = part.inline_data.mime_type or "image/png"
                return part.inline_data.data, mime_type
    return None


async def _generate_content_with_retry(**kwargs) -> types.GenerateContentResponse:
    client = _get_client()
    for attempt, delay in enumerate((*IMAGE_RETRY_DELAYS_SECONDS, None)):
        try:
            return await client.aio.models.generate_content(**kwargs)
        except errors.ServerError:
            if delay is None:
                raise
            await asyncio.sleep(delay)
    raise AssertionError("unreachable")


async def _generate_one_preview(enhanced_prompt: str) -> str | None:
    try:
        response = await _generate_content_with_retry(
            model=IMAGE_MODEL,
            contents=enhanced_prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(image_size="1K"),
            ),
        )
    except errors.APIError:
        # Don't let one failed preview take down the other 3 (caller records status: failed).
        return None
    extracted = _extract_image_part(response)
    return save_image_bytes(*extracted) if extracted else None


async def generate_preview_batch(enhanced_prompt: str) -> list[str | None]:
    """Generate the 4 previews in parallel.

    Gemini's image generation models don't support candidateCount (returning
    multiple candidates in one call), so individual requests are fanned out with
    asyncio.gather instead.
    """
    tasks = [_generate_one_preview(enhanced_prompt) for _ in range(PREVIEW_COUNT)]
    return await asyncio.gather(*tasks)


async def generate_final_image(enhanced_prompt: str, reference_image_path: str) -> str | None:
    reference_path = BACKEND_ROOT / reference_image_path.lstrip("/")
    reference_mime_type = mimetypes.guess_type(reference_path.name)[0] or "image/png"
    reference_part = types.Part.from_bytes(data=reference_path.read_bytes(), mime_type=reference_mime_type)

    try:
        response = await _generate_content_with_retry(
            model=IMAGE_MODEL,
            # Pass the selected preview as a reference image to upscale to 4K while
            # preserving its composition.
            contents=[reference_part, enhanced_prompt],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(image_size="4K", aspect_ratio=IMAGE_ASPECT_RATIO),
            ),
        )
    except errors.APIError:
        # The caller (main.py) records None as final_status: failed.
        return None
    extracted = _extract_image_part(response)
    return save_image_bytes(*extracted) if extracted else None
