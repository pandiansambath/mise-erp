"""hotel prefs: how this restaurant wants its numbers and its paperwork

He asked for several things to be "configurable" rather than decided for him —
how PDFs are grouped, how many decimals a quantity shows. Rather than a column
per preference, one JSON bag: a preference is a small, additive, per-hotel
choice, and each new one should not cost a migration.

Deliberately NOT reusing `features`: that is the plan/entitlement gate (what a
hotel is allowed to use). This is taste (how they want it to look). Mixing the
two would mean a display preference could be read as a licence.

Revision ID: 41433d120492
Revises: 354d5cbe6181
"""

import sqlalchemy as sa

from alembic import op

revision: str = "41433d120492"
down_revision: str | None = "354d5cbe6181"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column(
            "prefs",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("hotels", "prefs")
