from datetime import datetime

from pydantic import BaseModel, Field

from models import GenerationStatus


class GeneratePreviewRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=200)


class PreviewImageOut(BaseModel):
    preview_id: int
    candidate_index: int
    image_path: str | None
    status: GenerationStatus
    # The result of finalizing this preview to 4K. Each preview holds its own independently.
    final_image_path: str | None = None
    final_status: GenerationStatus | None = None
    finalized_at: datetime | None = None


class GeneratePreviewResponse(BaseModel):
    session_id: int
    enhanced_prompt: str
    previews: list[PreviewImageOut]


class FinalizeRequest(BaseModel):
    session_id: int
    preview_id: int


class FinalizeResponse(BaseModel):
    session_id: int
    preview_id: int
    image_path: str | None
    status: GenerationStatus
    created_at: datetime


class HistorySessionItem(BaseModel):
    session_id: int
    original_prompt: str
    enhanced_prompt: str
    created_at: datetime
    previews: list[PreviewImageOut]
