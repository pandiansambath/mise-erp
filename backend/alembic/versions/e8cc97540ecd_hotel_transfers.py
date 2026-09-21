"""moving or copying a restaurant to another account, with consent on both sides

    "for migration both side need to accept (have this accpet featreu in
     setting email etcetc in new email)"

Two decisions taken at different times, in different sessions, possibly days
apart. There is nowhere to hold that except a row — and the row is also the
answer to "who agreed to this, and when", which is the question that matters
most in the case where somebody later says they did not.

NO FOREIGN KEY ON `hotel_id`, deliberately. The restaurant can be deleted
while a request is outstanding, and the record of the request should outlive
it: "what happened to my restaurant" is precisely what this table is for. The
FK on `requested_by` is SET NULL for the same reason — losing the user must
not take the history with it.

`to_email` is text rather than a user id because on a COPY the receiver has
no account yet (that is the point), and on a MOVE the address is the thing
that was agreed to, so it must not silently follow a later email change.

Revision ID: e8cc97540ecd
Revises: 26a0d4975473
"""

import sqlalchemy as sa

from alembic import op

revision = "e8cc97540ecd"
down_revision = "26a0d4975473"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hotel_transfers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("hotel_name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("state", sa.String(length=12), nullable=False, server_default="requested"),
        sa.Column(
            "requested_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("from_email", sa.String(length=255), nullable=False),
        sa.Column("to_email", sa.String(length=255), nullable=False),
        sa.Column("accept_token", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_hotel_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
    )
    op.create_index("ix_hotel_transfers_hotel_id", "hotel_transfers", ["hotel_id"])
    op.create_index("ix_hotel_transfers_state", "hotel_transfers", ["state"])
    op.create_index("ix_hotel_transfers_to_email", "hotel_transfers", ["to_email"])
    # UNIQUE, and that is the single-use guarantee. The token is cleared the
    # moment it is spent, so a forwarded email is not a second chance at
    # accepting — and two rows can never share one link.
    op.create_index(
        "ix_hotel_transfers_accept_token", "hotel_transfers", ["accept_token"], unique=True
    )
    # AT MOST ONE LIVE REQUEST PER RESTAURANT. Two outstanding moves for the
    # same hotel is a race with somebody's entire business as the stake: both
    # accepted, and whichever executes second finds the data already gone.
    # Partial, so the settled history is unlimited.
    op.create_index(
        "uq_hotel_transfers_one_open",
        "hotel_transfers",
        ["hotel_id"],
        unique=True,
        postgresql_where=sa.text("state IN ('requested', 'accepted')"),
    )


def downgrade() -> None:
    op.drop_index("uq_hotel_transfers_one_open", table_name="hotel_transfers")
    op.drop_index("ix_hotel_transfers_accept_token", table_name="hotel_transfers")
    op.drop_index("ix_hotel_transfers_to_email", table_name="hotel_transfers")
    op.drop_index("ix_hotel_transfers_state", table_name="hotel_transfers")
    op.drop_index("ix_hotel_transfers_hotel_id", table_name="hotel_transfers")
    op.drop_table("hotel_transfers")
