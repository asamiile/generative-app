"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-05

"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("original_prompt", sa.String(length=200), nullable=False),
        sa.Column("enhanced_prompt", sa.Text(), nullable=False),
        sa.Column("selected_preview_id", sa.Integer(), nullable=True),
        sa.Column("final_image_path", sa.String(length=255), nullable=True),
        sa.Column(
            "final_status",
            sa.Enum("success", "failed", name="generationstatus"),
            nullable=True,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "resolution",
            sa.String(length=16),
            nullable=False,
            server_default="4K",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sessions_created_at", "sessions", ["created_at"])

    op.create_table(
        "preview_images",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "session_id",
            sa.Integer(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("candidate_index", sa.Integer(), nullable=False),
        sa.Column("image_path", sa.String(length=255), nullable=True),
        sa.Column(
            "status",
            sa.Enum("success", "failed", name="generationstatus"),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_preview_images_session_id", "preview_images", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_preview_images_session_id", table_name="preview_images")
    op.drop_table("preview_images")
    op.drop_index("ix_sessions_created_at", table_name="sessions")
    op.drop_table("sessions")
