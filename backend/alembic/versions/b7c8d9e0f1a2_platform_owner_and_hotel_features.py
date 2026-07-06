"""platform: users.is_platform_owner + hotels.features (entitlements)

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-07-06

The Mise operator (platform owner) manages ALL hotels from a Control Room. This
adds:
  • users.is_platform_owner — a cross-tenant super-flag (default False for every
    normal hotel user); only the operator account(s) get it.
  • hotels.features — a JSON map of feature-key -> bool entitlements (e.g.
    {"ai_copilot": false}). Missing keys default to enabled, so existing hotels
    keep everything until the operator turns something off. Foundation for future
    subscription / plan tiers.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "b7c8d9e0f1a2"
down_revision: str | None = "a6b7c8d9e0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_platform_owner", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "hotels",
        sa.Column("features", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("hotels", "features")
    op.drop_column("users", "is_platform_owner")
