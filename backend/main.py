import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from auth import verify_token
from database import get_db, init_db
from models import GenerationSession, GenerationStatus, PreviewImage, ProviderType
from providers import get_provider
from schemas import (
    FinalizeRequest,
    FinalizeResponse,
    GeneratePreviewRequest,
    GeneratePreviewResponse,
    HistorySessionItem,
    PreviewImageOut,
    RetryPreviewRequest,
)

def _as_utc(dt: datetime) -> datetime:
    """SQLite round-trips DateTime columns as naive datetimes even when declared
    DateTime(timezone=True) -- but the values are always UTC (func.now() on SQLite
    returns UTC, and app code that sets these writes datetime.now(timezone.utc)).
    Attach UTC tzinfo explicitly before serializing into a response: Pydantic
    serializes a naive datetime with no offset suffix, and JS's `new Date(...)`
    then misparses that as local time instead of UTC.
    """
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


RATE_LIMIT_PER_HOUR = os.environ.get("RATE_LIMIT_PER_HOUR", "10")
# RATE_LIMIT_PER_HOUR is shared by both providers rather than split (e.g. a separate
# RATE_LIMIT_PER_HOUR_LOCAL): local generation has no per-request API cost, but a
# single-instance ComfyUI/Ollama setup still benefits from the same cap to avoid
# queue pile-up. Split this out later if that turns out to be too conservative.


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="generative-app", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get(
    "/api/providers",
    response_model=list[ProviderType],
    dependencies=[Depends(verify_token)],
)
def get_available_providers() -> list[ProviderType]:
    """Providers with everything needed to actually run, so the frontend can hide
    the rest from the model picker instead of letting a request fail on submit.
    `local` needs no API key (just Ollama/ComfyUI, which have working defaults),
    so it's always included; the other three need their key set in backend/.env.
    """
    available = [ProviderType.LOCAL]
    if os.environ.get("GEMINI_API_KEY"):
        available.append(ProviderType.GEMINI)
    if os.environ.get("OPENAI_API_KEY"):
        available.append(ProviderType.OPENAI)
    if os.environ.get("STABILITY_API_KEY"):
        available.append(ProviderType.STABILITY)
    return available


@app.post(
    "/api/generate/preview",
    response_model=GeneratePreviewResponse,
    dependencies=[Depends(verify_token)],
)
@limiter.limit(f"{RATE_LIMIT_PER_HOUR}/hour")
async def generate_preview(
    request: Request,
    body: GeneratePreviewRequest,
    db: DBSession = Depends(get_db),
) -> GeneratePreviewResponse:
    provider = get_provider(body.provider.value)

    # Every provider's expand_prompt can raise (SDK error, httpx error, etc.) and
    # none of them catch it themselves -- there's nothing to save yet at this point
    # (no session row, no images attempted), so this is a clean 502 rather than
    # trying to record a "failed" session with no enhanced_prompt to store.
    try:
        enhanced_prompt = await provider.expand_prompt(body.prompt)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to expand the prompt via {body.provider.value}: {exc}",
        ) from exc

    # Commit here to release the write lock before the slow generation call. Flushing
    # without committing across a long external call would hold SQLite's write
    # lock the whole time, making other requests fail immediately with
    # "database is locked".
    session = GenerationSession(
        original_prompt=body.prompt,
        enhanced_prompt=enhanced_prompt,
        provider=body.provider,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    image_paths = await provider.generate_preview_batch(enhanced_prompt)

    previews: list[PreviewImage] = []
    for index, image_path in enumerate(image_paths):
        preview = PreviewImage(
            session_id=session.id,
            candidate_index=index,
            image_path=image_path,
            status=GenerationStatus.SUCCESS if image_path else GenerationStatus.FAILED,
            error_message=None if image_path else "Failed to generate the preview image",
            provider=body.provider,
        )
        db.add(preview)
        previews.append(preview)

    db.commit()
    for preview in previews:
        db.refresh(preview)

    return GeneratePreviewResponse(
        session_id=session.id,
        enhanced_prompt=enhanced_prompt,
        provider=session.provider,
        previews=[
            PreviewImageOut(
                preview_id=p.id,
                candidate_index=p.candidate_index,
                image_path=p.image_path,
                status=p.status,
                provider=p.provider,
            )
            for p in previews
        ],
    )


@app.post(
    "/api/generate/finalize",
    response_model=FinalizeResponse,
    dependencies=[Depends(verify_token)],
)
@limiter.limit(f"{RATE_LIMIT_PER_HOUR}/hour")
async def generate_finalize(
    request: Request,
    body: FinalizeRequest,
    db: DBSession = Depends(get_db),
) -> FinalizeResponse:
    session = db.get(GenerationSession, body.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    preview = db.get(PreviewImage, body.preview_id)
    if preview is None or preview.session_id != session.id or preview.image_path is None:
        raise HTTPException(status_code=400, detail="invalid preview_id for this session")

    # Falls back to this preview's OWN provider, not the session's: individual
    # retry (see /api/generate/preview/retry below) can give a preview a different
    # provider than the rest of the session, and finalize's default should follow
    # whatever actually generated the image being finalized, not the session's
    # original (possibly stale) provider.
    provider_name = body.provider.value if body.provider else preview.provider.value
    provider = get_provider(provider_name)
    image_path = await provider.generate_final_image(session.enhanced_prompt, preview.image_path)

    # The 4K result is kept per-preview so multiple previews in the same session can
    # each be finalized independently — a session-level field could only hold one,
    # and a later finalize would overwrite an earlier one.
    preview.final_image_path = image_path
    preview.final_status = GenerationStatus.SUCCESS if image_path else GenerationStatus.FAILED
    preview.final_error_message = None if image_path else "Failed to generate the final 4K image"
    preview.final_provider = ProviderType(provider_name)
    preview.resolution = "4K"
    preview.finalized_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(preview)

    return FinalizeResponse(
        session_id=session.id,
        preview_id=preview.id,
        image_path=preview.final_image_path,
        status=preview.final_status,
        provider=preview.final_provider,
        created_at=_as_utc(preview.finalized_at),
    )


@app.post(
    "/api/generate/preview/retry",
    response_model=PreviewImageOut,
    dependencies=[Depends(verify_token)],
)
@limiter.limit(f"{RATE_LIMIT_PER_HOUR}/hour")
async def retry_preview(
    request: Request,
    body: RetryPreviewRequest,
    db: DBSession = Depends(get_db),
) -> PreviewImageOut:
    """Regenerate a single preview candidate in place, optionally with a different
    provider than the one that made it. Overwrites this preview_images row's
    image_path/status/error_message/provider -- there's no value in keeping a
    failed (or unwanted) attempt around once it's been retried, and the UI should
    just reflect the latest attempt for this candidate_index. Does NOT touch the
    other 3 previews or the session's own `provider`, which stays a record of what
    the session started with."""
    session = db.get(GenerationSession, body.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    preview = db.get(PreviewImage, body.preview_id)
    if preview is None or preview.session_id != session.id:
        raise HTTPException(status_code=400, detail="invalid preview_id for this session")

    provider_name = body.provider.value if body.provider else preview.provider.value
    provider = get_provider(provider_name)
    image_path = await provider.generate_one_preview(session.enhanced_prompt)

    preview.image_path = image_path
    preview.status = GenerationStatus.SUCCESS if image_path else GenerationStatus.FAILED
    preview.error_message = None if image_path else "Failed to generate the preview image"
    preview.provider = ProviderType(provider_name)
    # Clear any existing finalize result: it was made FROM the old image_path as a
    # reference, so it no longer corresponds to what this preview now shows. The
    # UI currently only offers retry on failed previews (which can't have a
    # finalize result yet), but this guards the API itself against that mismatch
    # regardless of what the UI allows.
    preview.final_image_path = None
    preview.final_status = None
    preview.final_error_message = None
    preview.final_provider = None
    preview.resolution = None
    preview.finalized_at = None

    db.commit()
    db.refresh(preview)

    return PreviewImageOut(
        preview_id=preview.id,
        candidate_index=preview.candidate_index,
        image_path=preview.image_path,
        status=preview.status,
        provider=preview.provider,
        final_image_path=preview.final_image_path,
        final_status=preview.final_status,
        final_provider=preview.final_provider,
        finalized_at=_as_utc(preview.finalized_at) if preview.finalized_at else None,
    )


@app.get(
    "/api/history",
    response_model=list[HistorySessionItem],
    dependencies=[Depends(verify_token)],
)
def get_history(
    limit: int = 20,
    offset: int = 0,
    sort: Literal["newest", "oldest"] = "newest",
    q: str | None = None,
    db: DBSession = Depends(get_db),
) -> list[HistorySessionItem]:
    # Group all 4 previews under their session regardless of finalize state, since
    # the History screen renders them grouped.
    # created_at is SQLite's CURRENT_TIMESTAMP (second precision), so rows created in
    # the same second sort non-deterministically; id as a tiebreaker keeps it stable.
    if sort == "oldest":
        order_by = (GenerationSession.created_at.asc(), GenerationSession.id.asc())
    else:
        order_by = (GenerationSession.created_at.desc(), GenerationSession.id.desc())
    session_stmt = select(GenerationSession)
    # Server-side, not client-side over the currently-loaded page: filtering only
    # what's already in the browser would silently miss matches on unloaded pages,
    # with no way to page further in since "Load more" paginates the unfiltered set.
    if q:
        session_stmt = session_stmt.where(GenerationSession.original_prompt.ilike(f"%{q}%"))
    session_stmt = session_stmt.order_by(*order_by).limit(limit).offset(offset)
    sessions = db.scalars(session_stmt).all()

    previews_by_session: dict[int, list[PreviewImage]] = {s.id: [] for s in sessions}
    if sessions:
        preview_stmt = (
            select(PreviewImage)
            .where(PreviewImage.session_id.in_(previews_by_session.keys()))
            .order_by(PreviewImage.candidate_index)
        )
        for p in db.scalars(preview_stmt).all():
            previews_by_session[p.session_id].append(p)

    return [
        HistorySessionItem(
            session_id=s.id,
            original_prompt=s.original_prompt,
            enhanced_prompt=s.enhanced_prompt,
            provider=s.provider,
            created_at=_as_utc(s.created_at),
            previews=[
                PreviewImageOut(
                    preview_id=p.id,
                    candidate_index=p.candidate_index,
                    image_path=p.image_path,
                    status=p.status,
                    provider=p.provider,
                    final_image_path=p.final_image_path,
                    final_status=p.final_status,
                    final_provider=p.final_provider,
                    finalized_at=_as_utc(p.finalized_at) if p.finalized_at else None,
                )
                for p in previews_by_session[s.id]
            ],
        )
        for s in sessions
    ]
