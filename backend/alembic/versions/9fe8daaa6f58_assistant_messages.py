"""assistant_messages — the assistant's memory, kept per user rather than per browser

Revision ID: 9fe8daaa6f58
Revises: ef4453d8b052
"""
import sqlalchemy as sa

from alembic import op

revision: str = "9fe8daaa6f58"
down_revision: str | None = "ef4453d8b052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("thread_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=12), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_assistant_messages_hotel_id", "assistant_messages", ["hotel_id"])
    op.create_index("ix_assistant_messages_thread_id", "assistant_messages", ["thread_id"])
    # Every read is "this user's messages, newest first" — one index for both.
    op.create_index("ix_assistant_messages_user_time", "assistant_messages", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_assistant_messages_user_time", table_name="assistant_messages")
    op.drop_index("ix_assistant_messages_thread_id", table_name="assistant_messages")
    op.drop_index("ix_assistant_messages_hotel_id", table_name="assistant_messages")
    op.drop_table("assistant_messages")
