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
    """1回のプロンプト入力 = 1セッション。プレビュー4枚と本番(4K)1枚を紐づける。"""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    original_prompt: Mapped[str] = mapped_column(String(200), nullable=False)
    enhanced_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # preview_images.id への論理参照。SQLiteは循環FK(sessions<->preview_images)を
    # ALTER TABLEで後付けできないため、DB制約は付けずアプリ側で整合性を保証する。
    selected_preview_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    final_image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    final_status: Mapped[GenerationStatus | None] = mapped_column(_status_enum(), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution: Mapped[str] = mapped_column(String(16), nullable=False, default="4K", server_default="4K")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PreviewImage(Base):
    """1セッションにつき4件生成される低解像度プレビュー。"""

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
