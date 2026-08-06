"""move finalize (4K) state from sessions to preview_images

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-06

"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "preview_images",
        sa.Column("final_image_path", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "preview_images",
        sa.Column(
            "final_status",
            sa.Enum("success", "failed", name="generationstatus"),
            nullable=True,
        ),
    )
    op.add_column(
        "preview_images",
        sa.Column("final_error_message", sa.Text(), nullable=True),
    )
    op.add_column(
        "preview_images",
        sa.Column("resolution", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "preview_images",
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Carry each existing session's 4K result (for its one selected preview) over to the
    # corresponding preview_images row. The sessions-side columns get dropped below, so
    # anything not moved here is lost.
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT selected_preview_id, final_image_path, final_status, "
            "error_message, resolution, finalized_at "
            "FROM sessions WHERE selected_preview_id IS NOT NULL"
        )
    ).fetchall()
    for row in rows:
        connection.execute(
            sa.text(
                "UPDATE preview_images SET "
                "final_image_path = :final_image_path, "
                "final_status = :final_status, "
                "final_error_message = :final_error_message, "
                "resolution = :resolution, "
                "finalized_at = :finalized_at "
                "WHERE id = :preview_id"
            ),
            {
                "final_image_path": row.final_image_path,
                "final_status": row.final_status,
                "final_error_message": row.error_message,
                "resolution": row.resolution,
                "finalized_at": row.finalized_at,
                "preview_id": row.selected_preview_id,
            },
        )

    with op.batch_alter_table("sessions") as batch_op:
        batch_op.drop_column("selected_preview_id")
        batch_op.drop_column("final_image_path")
        batch_op.drop_column("final_status")
        batch_op.drop_column("error_message")
        batch_op.drop_column("resolution")
        batch_op.drop_column("finalized_at")


def downgrade() -> None:
    with op.batch_alter_table("sessions") as batch_op:
        batch_op.add_column(sa.Column("selected_preview_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("final_image_path", sa.String(length=255), nullable=True))
        batch_op.add_column(
            sa.Column(
                "final_status",
                sa.Enum("success", "failed", name="generationstatus"),
                nullable=True,
            )
        )
        batch_op.add_column(sa.Column("error_message", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column("resolution", sa.String(length=16), nullable=False, server_default="4K")
        )
        batch_op.add_column(sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True))

    op.drop_column("preview_images", "finalized_at")
    op.drop_column("preview_images", "resolution")
    op.drop_column("preview_images", "final_error_message")
    op.drop_column("preview_images", "final_status")
    op.drop_column("preview_images", "final_image_path")
