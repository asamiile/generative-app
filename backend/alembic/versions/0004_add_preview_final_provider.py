"""add final_provider column to preview_images

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-08

"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "preview_images",
        sa.Column(
            "final_provider",
            sa.Enum("gemini", "local", name="providertype"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("preview_images", "final_provider")
