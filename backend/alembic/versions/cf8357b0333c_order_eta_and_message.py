"""A per-ticket estimate, and a message from the table.

Revision ID: cf8357b0333c
Revises: 5a9e6a22d312

    "we need one feature like chef and super admin can change the estimated time
     for each table orders"

The hotel-wide prep time is a decent default and a poor promise. A biryani is
forty minutes and a lassi is two; the kitchen knows which, and the diner staring
at a countdown deserves the kitchen's answer rather than an average. NULL keeps
the hotel default, so nothing changes until somebody has an opinion.

    "customer sitting in table can also msg using that QR... he can send
     whatever he want"

Kept as its own column rather than appended to `note`, because a note is what
the KITCHEN needs to cook the dish right and a message is a conversation with
the room. Mixing them means "no chilli" and "can we get more water" arrive as
one blob and the cook has to work out which half applies to the pan.
"""

import sqlalchemy as sa

from alembic import op

revision = "cf8357b0333c"
down_revision = "5a9e6a22d312"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # What the KITCHEN says this particular ticket will take. NULL = the
    # hotel's default.
    op.add_column("orders", sa.Column("eta_minutes", sa.Integer(), nullable=True))
    # The last thing the table said, and when.
    op.add_column("orders", sa.Column("guest_message", sa.Text(), nullable=True))
    op.add_column(
        "orders", sa.Column("guest_message_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("orders", "guest_message_at")
    op.drop_column("orders", "guest_message")
    op.drop_column("orders", "eta_minutes")
