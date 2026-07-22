"""Staff-lending talent board + persisted hotel-to-hotel chat.

Revision ID: 8dad8ea10cd5
Revises: bea02e54b73d
Create Date: 2026-07-15
"""
import sqlalchemy as sa

from alembic import op

revision: str = "8dad8ea10cd5"
down_revision: str | None = "bea02e54b73d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_posts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("worker_name", sa.String(120), nullable=False),
        sa.Column("role_title", sa.String(80), nullable=False),
        sa.Column("blurb", sa.Text(), nullable=False, server_default=""),
        sa.Column("skills", sa.String(300), nullable=True),
        sa.Column("available_from", sa.Date(), nullable=True),
        sa.Column("available_until", sa.Date(), nullable=True),
        sa.Column("day_rate", sa.Numeric(8, 2), nullable=True),
        sa.Column("resume_key", sa.String(255), nullable=True),
        sa.Column("resume_filename", sa.String(255), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="OPEN", index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "chats",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_a", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("hotel_b", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("staff_post_id", sa.Uuid(), sa.ForeignKey("staff_posts.id"), nullable=True),
        sa.Column("a_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("b_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("chat_id", sa.Uuid(), sa.ForeignKey("chats.id"), nullable=False, index=True),
        sa.Column("sender_hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column("sender_name", sa.String(120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
    )


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("chats")
    op.drop_table("staff_posts")
