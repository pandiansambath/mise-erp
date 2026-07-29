"""assistant_threads — conversations you can recognise in a list

Revision ID: 48158cdb14ea
Revises: fdc7c0c3d8b7
"""
import sqlalchemy as sa

from alembic import op

revision: str = "48158cdb14ea"
down_revision: str | None = "fdc7c0c3d8b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_threads",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False, server_default="New chat"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_assistant_threads_hotel_id", "assistant_threads", ["hotel_id"])
    # The sidebar lists a person's threads, newest first — one index for both.
    op.create_index(
        "ix_assistant_threads_user_time", "assistant_threads", ["user_id", "updated_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_assistant_threads_user_time", table_name="assistant_threads")
    op.drop_index("ix_assistant_threads_hotel_id", table_name="assistant_threads")
    op.drop_table("assistant_threads")
