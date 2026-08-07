"""What the wall tablet looks like.

Stored per HOTEL rather than read from the browser, because the tablet is a
different browser from the owner's — a theme kept in localStorage would never
reach it. Null means dark, which is the safe default for a screen that lives
in a kitchen.

Revision ID: c783d6dd7c4a
Revises: 5cf6b0d68f26
"""
import sqlalchemy as sa

from alembic import op

revision = "c783d6dd7c4a"
down_revision = "5cf6b0d68f26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hotels", sa.Column("kiosk_theme", sa.String(length=24), nullable=True))


def downgrade() -> None:
    op.drop_column("hotels", "kiosk_theme")
