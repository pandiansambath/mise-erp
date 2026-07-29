"""hotels.trial_ends_on — so a trial can start, and actually end

Revision ID: c76fd15201d3
Revises: 9fe8daaa6f58
"""
import sqlalchemy as sa

from alembic import op

revision: str = "c76fd15201d3"
down_revision: str | None = "9fe8daaa6f58"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: existing hotels are not on trial, and must not become so.
    op.add_column("hotels", sa.Column("trial_ends_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("hotels", "trial_ends_on")
