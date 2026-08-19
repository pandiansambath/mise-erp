"""A QR on every table, so nobody has to wave at a waiter.

Revision ID: 8eaf4aafbbcf
Revises: 2d320918a015

His brief, and it is the sharpest product idea in this project so far:

    "when customer comes to hotel and he needs to call the bearer to order
     food... which means customer needs to call and wait for him to come and
     take the orders. What if we automate this — we can keep a QR made special
     for that table alone, so each table will have a separate QR... customer
     comes and sits on the table and scans the QR, here all items menu with
     detail, combos, literally the menu will be here. Customer can pick and
     order, which will show real-time estimation to bring that food. At the
     same time, the other side — customer, table, items etc — will be displayed
     to a tab inside the kitchen, so the chef can make the dish and serve to
     that particular table."

Two tables' worth of schema, because the ordering system already exists: this
is the same `orders` pipeline the takeaway page uses, entered through a
different door and pinned to a seat.

`dining_tables` is per hotel and configurable, because we cannot know how many
tables anyone has. `code` is what the QR actually encodes — short, unguessable
and stable, so a printed card keeps working when the table is renamed from
"4" to "Terrace 2".
"""

import sqlalchemy as sa

from alembic import op

revision = "8eaf4aafbbcf"
down_revision = "2d320918a015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dining_tables",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        # What the staff call it. Renaming must not invalidate a printed card,
        # which is why the QR encodes `code` and never this.
        sa.Column("label", sa.String(length=40), nullable=False),
        # What the QR encodes. Random rather than sequential: table codes are
        # printed on cards that live in a public room, and /t/2 would invite
        # ordering onto somebody else's bill by typing /t/3.
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("seats", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["hotel_id"], ["hotels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_dining_table_code"),
        sa.UniqueConstraint("hotel_id", "label", name="uq_dining_table_label"),
    )
    op.create_index("ix_dining_tables_hotel_id", "dining_tables", ["hotel_id"])

    # Which seat an order came from. NULL for takeaway and delivery, which is
    # every order that exists today.
    op.add_column("orders", sa.Column("table_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_orders_table", "orders", "dining_tables", ["table_id"], ["id"], ondelete="SET NULL"
    )
    # A diner pressing "we need someone" — the automated version of waving.
    # Timestamped rather than boolean so the kitchen screen can show how long
    # they have been waiting, which is the part that actually matters.
    op.add_column("orders", sa.Column("help_requested_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "help_requested_at")
    op.drop_constraint("fk_orders_table", "orders", type_="foreignkey")
    op.drop_column("orders", "table_id")
    op.drop_index("ix_dining_tables_hotel_id", table_name="dining_tables")
    op.drop_table("dining_tables")
