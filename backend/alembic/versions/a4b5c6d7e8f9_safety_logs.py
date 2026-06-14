"""safety_logs — food-safety temperature readings + daily checks

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-06-14
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a4b5c6d7e8f9"
down_revision: str | None = "f3a4b5c6d7e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "safety_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("reading", sa.Numeric(6, 2), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("logged_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["hotel_id"], ["hotels.id"]),
        sa.ForeignKeyConstraint(["logged_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_safety_logs_hotel_id", "safety_logs", ["hotel_id"])
    op.create_index("ix_safety_logs_date", "safety_logs", ["date"])


def downgrade() -> None:
    op.drop_index("ix_safety_logs_date", table_name="safety_logs")
    op.drop_index("ix_safety_logs_hotel_id", table_name="safety_logs")
    op.drop_table("safety_logs")
