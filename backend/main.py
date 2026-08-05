import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

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
    HistoryItem,
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

    session = GenerationSession(original_prompt=body.prompt, enhanced_prompt=enhanced_prompt)
    db.add(session)
    db.flush()

    image_paths = await services.generate_preview_batch(enhanced_prompt)

    previews: list[PreviewImage] = []
    for index, image_path in enumerate(image_paths):
        preview = PreviewImage(
            session_id=session.id,
            candidate_index=index,
            image_path=image_path,
            status=GenerationStatus.SUCCESS if image_path else GenerationStatus.FAILED,
            error_message=None if image_path else "プレビュー画像の生成に失敗しました",
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

    session.selected_preview_id = preview.id
    session.final_image_path = image_path
    session.final_status = GenerationStatus.SUCCESS if image_path else GenerationStatus.FAILED
    session.error_message = None if image_path else "本番(4K)画像の生成に失敗しました"
    session.finalized_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(session)

    return FinalizeResponse(
        session_id=session.id,
        image_path=session.final_image_path,
        status=session.final_status,
        created_at=session.finalized_at,
    )


@app.get(
    "/api/history",
    response_model=list[HistoryItem],
    dependencies=[Depends(verify_token)],
)
def get_history(
    limit: int = 20,
    offset: int = 0,
    db: DBSession = Depends(get_db),
) -> list[HistoryItem]:
    stmt = (
        select(GenerationSession)
        .where(GenerationSession.final_status == GenerationStatus.SUCCESS)
        .order_by(GenerationSession.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    sessions = db.scalars(stmt).all()
    return [
        HistoryItem(
            session_id=s.id,
            original_prompt=s.original_prompt,
            enhanced_prompt=s.enhanced_prompt,
            image_path=s.final_image_path,
            created_at=s.created_at,
        )
        for s in sessions
    ]
