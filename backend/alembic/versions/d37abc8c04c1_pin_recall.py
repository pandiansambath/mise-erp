"""Keep the attendance PIN readable, so the owner can be told it again.

    "why everytime it asking to create pin... let use previous pin...if needed
     means we can create new pin"

The PIN was hashed and nothing else, which made the screen physically unable
to answer "what is my PIN?" — so the only thing it could offer was a new one,
every single time. That is the whole complaint: the UI was not nagging by
choice, it was nagging because it had no other move.

The hash STAYS and remains the only thing `verify()` consults. This column is
a second, reversible copy used purely to show the owner their own door code
after they re-enter their password.

Revision ID: d37abc8c04c1
"""
import sqlalchemy as sa

from alembic import op

revision = "d37abc8c04c1"
down_revision = "5cd64fffed9c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hotels", sa.Column("attendance_pin_enc", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("hotels", "attendance_pin_enc")
