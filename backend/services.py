from __future__ import annotations

import asyncio
import mimetypes
import os
import uuid
from pathlib import Path

from google import genai
from google.genai import errors, types

BACKEND_ROOT = Path(__file__).parent
STATIC_IMAGES_DIR = BACKEND_ROOT / "static" / "images"
STATIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

TEXT_MODEL = "gemini-3.6-flash"
IMAGE_MODEL = "gemini-3-pro-image"
PREVIEW_COUNT = 4
# gemini-3-pro-imageは需要が高く503 UNAVAILABLEを返すことがあるため、短い間隔でリトライする。
IMAGE_RETRY_DELAYS_SECONDS = (2, 5, 10)

# 実写限定の絶対ルール。詳細はdocs/DESIGN.md 6章を参照。
SYSTEM_PROMPT = """You are a prompt writer for a photorealistic image generation model.
Rules:
- Output ONLY the English prompt for the image generation model. No explanations, no quotes, no markdown.
- The prompt MUST describe a photorealistic, live-action style photograph.
- Anime, illustration, or drawn/cartoon styles are strictly forbidden.
- Specify camera lens, depth of field, and lighting to reinforce a photographic look.
"""

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
        # ユーザー入力は指示ではなくデータとして扱う(プロンプトインジェクション対策)。
        contents=f'ユーザー入力: """{user_prompt}"""',
        config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
    )
    return response.text.strip()


def _extract_image_part(response: types.GenerateContentResponse) -> tuple[bytes, str] | None:
    """レスポンスから画像バイト列と実際のMIMEタイプを取り出す。

    Gemini画像モデルはPNG指定していてもJPEGを返すことがあるため、
    拡張子は固定せずレスポンスのmime_typeに従って決める。
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


def _save_image(image_bytes: bytes, mime_type: str) -> str:
    extension = mimetypes.guess_extension(mime_type) or ".png"
    filename = f"{uuid.uuid4()}{extension}"
    (STATIC_IMAGES_DIR / filename).write_bytes(image_bytes)
    return f"/static/images/{filename}"


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
        # 1枚の失敗で残り3枚のプレビューまで失わせない(呼び出し元でstatus: failedとして記録)。
        return None
    extracted = _extract_image_part(response)
    return _save_image(*extracted) if extracted else None


async def generate_preview_batch(enhanced_prompt: str) -> list[str | None]:
    """プレビュー4枚を並列生成する。

    Gemini APIの画像生成モデルはcandidateCount(複数候補の一括返却)に
    対応していないため、個別リクエストをasyncio.gatherで並列実行する。
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
            # 選択したプレビューを参照画像として渡し、構図を保持したまま4K化する。
            contents=[reference_part, enhanced_prompt],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(image_size="4K"),
            ),
        )
    except errors.APIError:
        # 呼び出し元(main.py)がNoneをfinal_status: failedとして記録する。
        return None
    extracted = _extract_image_part(response)
    return _save_image(*extracted) if extracted else None
