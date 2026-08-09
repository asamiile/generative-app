"""add preview_images.provider

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-09

Tracks which provider actually generated (or last regenerated, via the individual
retry endpoint) each preview -- previously only sessions.provider existed, which
was accurate for the initial batch of 4 but goes stale the moment any one preview
is retried with a different provider than the session started with. Existing rows
predate per-preview retry, so they're backfilled from their session's provider.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

_PROVIDER_ENUM = sa.Enum("gemini", "local", "openai", "stability", name="providertype")


def upgrade() -> None:
    op.add_column("preview_images", sa.Column("provider", _PROVIDER_ENUM, nullable=True))
    op.execute(
        """
        UPDATE preview_images
        SET provider = (SELECT provider FROM sessions WHERE sessions.id = preview_images.session_id)
        WHERE provider IS NULL
        """
    )
    with op.batch_alter_table("preview_images") as batch_op:
        batch_op.alter_column("provider", existing_type=_PROVIDER_ENUM, nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("preview_images") as batch_op:
        batch_op.drop_column("provider")
