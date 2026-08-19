"""How long each dish takes, so the diner's ETA is real.

Revision ID: b9b2711a2776
Revises: cf8357b0333c

    "super admin or chef can add an estimated time for each item in menu
     beforehand, so that when customer chooses that, once customer submitted the
     order they can instantly see somewhat correct ETA timing. This timing also
     they can change flexibly."

The hotel-wide prep time answers "how long is food here", which is the wrong
question: a biryani is forty minutes and a lassi is two, and a diner who ordered
one lassi should not be told twenty.

Three layers, narrowest wins:

    the ticket's own override   (the kitchen looked at it and knows)
    the longest dish on it      (you wait for the slowest thing, not the sum —
                                 a kitchen cooks in parallel, and adding the
                                 times promises a wait nobody will actually have)
    the hotel default           (nothing better to go on)
"""

import sqlalchemy as sa

from alembic import op

revision = "b9b2711a2776"
down_revision = "cf8357b0333c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("menu_items", sa.Column("prep_minutes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("menu_items", "prep_minutes")
