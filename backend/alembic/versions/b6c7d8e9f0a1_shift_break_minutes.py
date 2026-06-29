"""add shifts.break_minutes

Revision ID: b6c7d8e9f0a1
Revises: f2a3b4c5d6e7
Create Date: 2026-06-28

Unpaid break length on a shift — paid/working hours = shift length − break, which
flows into labour cost and labour %.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "b6c7d8e9f0a1"
down_revision: str | None = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shifts",
        sa.Column("break_minutes", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("shifts", "break_minutes")
