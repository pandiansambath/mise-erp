"""A half-built order that follows the person, not the browser.

The basket lived in localStorage, which is per browser and per profile. A
basket built on the kitchen tablet was invisible on a phone, and a private
window showed an empty one:

    "if i go to incognito and login same account, see basket is not there...
     i guess u not storing in db — please store in db"

One row per user, lines as JSON. A basket is a draft: rewritten wholesale on
every change, no history worth querying, and gone the moment it becomes an
indent. Line rows would buy nothing and cost a join.

Revision ID: a29fcc343fe2
Revises: 9dd92364a74a
"""

import sqlalchemy as sa

from alembic import op

revision: str = "a29fcc343fe2"
down_revision: str | None = "9dd92364a74a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "baskets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        # Unique: one basket each. Two people picking for the same kitchen are
        # doing two different jobs, and merging them would lose one.
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False, unique=True
        ),
        sa.Column("lines", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_baskets_hotel_id", "baskets", ["hotel_id"])


def downgrade() -> None:
    op.drop_index("ix_baskets_hotel_id", table_name="baskets")
    op.drop_table("baskets")
