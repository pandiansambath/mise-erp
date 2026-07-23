"""user deleted_at (permanent-removal tombstone)

Revision ID: 7df147b82e4e
Revises: 75bcb684ebd8
Create Date: 2026-07-23

Adds users.deleted_at. A permanently-removed login is anonymised (email freed,
password destroyed) and stamped here so the row survives as a tombstone — every
past action still resolves to it ("Removed user") — but it never appears in the
roster and can never sign in again.
"""
import sqlalchemy as sa

from alembic import op

revision = "7df147b82e4e"
down_revision = "75bcb684ebd8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "deleted_at")
