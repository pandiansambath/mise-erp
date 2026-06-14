"""item allergens — comma-separated allergen codes per item (Natasha's Law)

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-06-14
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f3a4b5c6d7e8"
down_revision: str | None = "e2f3a4b5c6d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NULL = not yet reviewed; "" = reviewed, none; "milk,gluten" = contains those.
    op.add_column("items", sa.Column("allergens", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("items", "allergens")
