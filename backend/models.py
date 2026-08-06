from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class GenerationStatus(str, enum.Enum):
    SUCCESS = "success"
    FAILED = "failed"


def _status_enum() -> SAEnum:
    return SAEnum(GenerationStatus, values_callable=lambda e: [member.value for member in e])


class GenerationSession(Base):
    """One prompt submission = one session, linked to 4 previews.

    The 4K result lives on preview_images, not here, so multiple previews within
    one session can each be finalized to 4K independently.
    """

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    original_prompt: Mapped[str] = mapped_column(String(200), nullable=False)
    enhanced_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class PreviewImage(Base):
    """One of the 4 low-resolution previews generated per session.

    The final_* columns hold the result of finalizing this preview (used as a
    reference image) to 4K. NULL until finalized. Each preview tracks its own
    finalize state independently.
    """

    __tablename__ = "preview_images"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    candidate_index: Mapped[int] = mapped_column(Integer, nullable=False)
    image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[GenerationStatus] = mapped_column(_status_enum(), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    final_image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    final_status: Mapped[GenerationStatus | None] = mapped_column(_status_enum(), nullable=True)
    final_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution: Mapped[str | None] = mapped_column(String(16), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
