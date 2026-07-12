"""platform_announcements — operator broadcast banners shown in every hotel's app

Revision ID: f6a7b8c9d0e1
Revises: f1a2b3c4d5e6
Create Date: 2026-07-12
"""
import sqlalchemy as sa

from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_announcements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("level", sa.String(length=10), nullable=False, server_default="info"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("platform_announcements")
