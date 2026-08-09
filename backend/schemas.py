from datetime import datetime

from pydantic import BaseModel, Field

from models import GenerationStatus, ProviderType


class GeneratePreviewRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=200)
    # Required, not defaulted -- the frontend always sends an explicit choice, and
    # with 4 equally-supported providers there's no longer a neutral default to
    # fall back to (see DEFAULT_IMAGE_PROVIDER's removal in main.py).
    provider: ProviderType


class PreviewImageOut(BaseModel):
    preview_id: int
    candidate_index: int
    image_path: str | None
    status: GenerationStatus
    # Provider that generated the current image_path/status. Initially the
    # session's provider; overwritten on individual retry, which can target a
    # different provider than the rest of the session.
    provider: ProviderType
    # The result of finalizing this preview to 4K. Each preview holds its own independently.
    final_image_path: str | None = None
    final_status: GenerationStatus | None = None
    # Provider used for this preview's finalize attempt, which may differ from the
    # session's (preview-generating) provider. None until finalize is attempted.
    final_provider: ProviderType | None = None
    finalized_at: datetime | None = None


class GeneratePreviewResponse(BaseModel):
    session_id: int
    enhanced_prompt: str
    provider: ProviderType
    previews: list[PreviewImageOut]


class FinalizeRequest(BaseModel):
    session_id: int
    preview_id: int
    # Falls back to this preview's own (current) provider when omitted -- may
    # differ from the session's provider once individual retry is in play (e.g.
    # previewed with Gemini, retried with Local, finalized with Gemini again
    # because local finalize is slow at high resolution).
    provider: ProviderType | None = None


class RetryPreviewRequest(BaseModel):
    session_id: int
    preview_id: int
    # Falls back to this preview's own (current) provider when omitted -- i.e. a
    # plain "try again" with the same provider unless a different one is chosen.
    provider: ProviderType | None = None


class FinalizeResponse(BaseModel):
    session_id: int
    preview_id: int
    image_path: str | None
    status: GenerationStatus
    provider: ProviderType
    created_at: datetime


class HistorySessionItem(BaseModel):
    session_id: int
    original_prompt: str
    enhanced_prompt: str
    provider: ProviderType
    created_at: datetime
    previews: list[PreviewImageOut]
