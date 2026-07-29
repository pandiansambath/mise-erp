"""hotels.trial_reminder_sent_on — so the trial warning is sent once, not daily

Revision ID: 43e5de6d9b86
Revises: 5c78ab0f594f

The reminder job runs every day and asks "whose trial ends soon?". Without a
marker, a hotel three days from expiry matches on all three of those days and
gets the same email three times — which reads as broken software at exactly the
moment we are asking someone to trust us with a card.

A date rather than a boolean, so a hotel whose trial is extended can be warned
again about the NEW date instead of being silently skipped forever.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "43e5de6d9b86"
down_revision: str | None = "5c78ab0f594f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hotels", sa.Column("trial_reminder_sent_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("hotels", "trial_reminder_sent_on")
