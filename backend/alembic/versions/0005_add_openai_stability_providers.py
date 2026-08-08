"""widen provider columns for openai/stability provider values

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-09

SQLite has no CHECK constraint on these columns (SQLAlchemy's Enum type didn't add
one on this SQLAlchemy version), so old rows/inserts already tolerate any string --
but the declared column type is VARCHAR(6) (auto-sized to fit "gemini", the longest
value when the enum only had gemini/local), which is too short to accurately
describe "stability" (9 chars). SQLite itself doesn't enforce VARCHAR(n) length, so
this is a schema-correctness fix, not a functional bug fix (matters if this project
or a fork ever runs against a backend that DOES enforce VARCHAR length, e.g. Postgres).
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

_PROVIDER_ENUM = sa.Enum("gemini", "local", "openai", "stability", name="providertype")
_OLD_PROVIDER_ENUM = sa.Enum("gemini", "local", name="providertype")


def upgrade() -> None:
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.alter_column(
            "provider",
            existing_type=sa.String(length=6),
            type_=_PROVIDER_ENUM,
            existing_nullable=False,
        )
    with op.batch_alter_table("preview_images") as batch_op:
        batch_op.alter_column(
            "final_provider",
            existing_type=sa.String(length=6),
            type_=_PROVIDER_ENUM,
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("preview_images") as batch_op:
        batch_op.alter_column(
            "final_provider",
            existing_type=_PROVIDER_ENUM,
            type_=_OLD_PROVIDER_ENUM,
            existing_nullable=True,
        )
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.alter_column(
            "provider",
            existing_type=_PROVIDER_ENUM,
            type_=_OLD_PROVIDER_ENUM,
            existing_nullable=False,
        )
