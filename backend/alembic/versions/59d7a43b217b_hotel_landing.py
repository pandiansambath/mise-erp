"""hotel landing (customizable per-subdomain public page)

Revision ID: 59d7a43b217b
Revises: 7df147b82e4e
Create Date: 2026-07-23

Adds hotels.landing (JSON) — the per-hotel customizable public landing page served
at <username>.dineai.cloud: tagline, about, quote, accent colour, theme, show-order.
Empty {} falls back to sensible defaults.
"""
import sqlalchemy as sa

from alembic import op

revision = "59d7a43b217b"
down_revision = "7df147b82e4e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column("landing", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("hotels", "landing")
