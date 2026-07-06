"""hotels: logo_key (uploaded brand logo, stored in S3/local)

Revision ID: a6b7c8d9e0f1
Revises: f5a6b7c8d9e0
Create Date: 2026-07-06

A hotel can upload its own logo; logo_key is the storage key ({hotel}/{id}/{file}).
When set, it replaces the default Mise mark in the app UI and on PDFs.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "a6b7c8d9e0f1"
down_revision: str | None = "f5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hotels", sa.Column("logo_key", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("hotels", "logo_key")
