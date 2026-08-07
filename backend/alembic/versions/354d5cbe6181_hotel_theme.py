"""The restaurant's own theme, in the database.

localStorage is per BROWSER, so the wall tablet — a different device entirely,
which the owner has never signed into — could never see what they picked. That
is why the kiosk kept coming up green while the dashboard was burgundy.

Revision ID: 354d5cbe6181
Revises: c783d6dd7c4a
"""
import sqlalchemy as sa

from alembic import op

revision = "354d5cbe6181"
down_revision = "c783d6dd7c4a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hotels", sa.Column("theme", sa.String(length=24), nullable=True))


def downgrade() -> None:
    op.drop_column("hotels", "theme")
