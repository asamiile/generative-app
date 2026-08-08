"""add provider column to sessions

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-07

"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A plain add_column suffices for a NOT NULL enum column with a literal
    # server_default on SQLite -- batch_alter_table is only needed for drop_column
    # (see migration 0002), not add_column.
    op.add_column(
        "sessions",
        sa.Column(
            "provider",
            sa.Enum("gemini", "local", name="providertype"),
            nullable=False,
            server_default="gemini",
        ),
    )


def downgrade() -> None:
    op.drop_column("sessions", "provider")
