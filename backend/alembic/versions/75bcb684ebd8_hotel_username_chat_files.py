"""Hotel usernames (global search handle) + chat message attachments (S3).

Revision ID: 75bcb684ebd8
Revises: 8dad8ea10cd5
Create Date: 2026-07-22
"""
import sqlalchemy as sa

from alembic import op

revision: str = "75bcb684ebd8"
down_revision: str | None = "8dad8ea10cd5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hotels", sa.Column("username", sa.String(40), nullable=True))
    op.create_index("ix_hotels_username", "hotels", ["username"], unique=True)
    op.add_column("chat_messages", sa.Column("attachment_key", sa.String(255), nullable=True))
    op.add_column("chat_messages", sa.Column("attachment_name", sa.String(255), nullable=True))
    op.add_column("chat_messages", sa.Column("attachment_type", sa.String(60), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "attachment_type")
    op.drop_column("chat_messages", "attachment_name")
    op.drop_column("chat_messages", "attachment_key")
    op.drop_index("ix_hotels_username", table_name="hotels")
    op.drop_column("hotels", "username")
