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

import services
from auth import verify_token
from database import get_db, init_db
from models import GenerationSession, GenerationStatus, PreviewImage
from schemas import (
    FinalizeRequest,
    FinalizeResponse,
    GeneratePreviewRequest,
    GeneratePreviewResponse,
    HistorySessionItem,
    PreviewImageOut,
)

RATE_LIMIT_PER_HOUR = os.environ.get("RATE_LIMIT_PER_HOUR", "10")


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
    enhanced_prompt = await services.expand_prompt(body.prompt)

    # Commit here to release the write lock before the slow Gemini call. Flushing
    # without committing across a long external API call would hold SQLite's write
    # lock the whole time, making other requests fail immediately with
    # "database is locked".
    session = GenerationSession(original_prompt=body.prompt, enhanced_prompt=enhanced_prompt)
    db.add(session)
    db.commit()
    db.refresh(session)

    image_paths = await services.generate_preview_batch(enhanced_prompt)

    previews: list[PreviewImage] = []
    for index, image_path in enumerate(image_paths):
        preview = PreviewImage(
            session_id=session.id,
            candidate_index=index,
            image_path=image_path,
            status=GenerationStatus.SUCCESS if image_path else GenerationStatus.FAILED,
            error_message=None if image_path else "Failed to generate the preview image",
        )
        db.add(preview)
        previews.append(preview)

    db.commit()
    for preview in previews:
        db.refresh(preview)

    return GeneratePreviewResponse(
        session_id=session.id,
        enhanced_prompt=enhanced_prompt,
        previews=[
            PreviewImageOut(
                preview_id=p.id,
                candidate_index=p.candidate_index,
                image_path=p.image_path,
                status=p.status,
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

    image_path = await services.generate_final_image(session.enhanced_prompt, preview.image_path)

    # The 4K result is kept per-preview so multiple previews in the same session can
    # each be finalized independently — a session-level field could only hold one,
    # and a later finalize would overwrite an earlier one.
    preview.final_image_path = image_path
    preview.final_status = GenerationStatus.SUCCESS if image_path else GenerationStatus.FAILED
    preview.final_error_message = None if image_path else "Failed to generate the final 4K image"
    preview.resolution = "4K"
    preview.finalized_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(preview)

    return FinalizeResponse(
        session_id=session.id,
        preview_id=preview.id,
        image_path=preview.final_image_path,
        status=preview.final_status,
        created_at=preview.finalized_at,
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
    session_stmt = (
        select(GenerationSession)
        .order_by(*order_by)
        .limit(limit)
        .offset(offset)
    )
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
            created_at=s.created_at,
            previews=[
                PreviewImageOut(
                    preview_id=p.id,
                    candidate_index=p.candidate_index,
                    image_path=p.image_path,
                    status=p.status,
                    final_image_path=p.final_image_path,
                    final_status=p.final_status,
                    finalized_at=p.finalized_at,
                )
                for p in previews_by_session[s.id]
            ],
        )
        for s in sessions
    ]
