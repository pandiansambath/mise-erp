"""add users.preferred_name

Revision ID: e1a2b3c4d5e6
Revises: d7e8f9a0b1c2
Create Date: 2026-06-27

The name the Copilot uses to address the user — stored server-side so it follows
them across devices.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "e1a2b3c4d5e6"
down_revision: str | None = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("preferred_name", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "preferred_name")
