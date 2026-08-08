from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path

BACKEND_ROOT = Path(__file__).parent.parent
STATIC_IMAGES_DIR = BACKEND_ROOT / "static" / "images"
STATIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def save_image_bytes(image_bytes: bytes, mime_type: str) -> str:
    extension = mimetypes.guess_extension(mime_type) or ".png"
    filename = f"{uuid.uuid4()}{extension}"
    (STATIC_IMAGES_DIR / filename).write_bytes(image_bytes)
    return f"/static/images/{filename}"
