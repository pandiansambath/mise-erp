"""A bottle is not the same size at every supplier.

Revision ID: 1566c9435cb1
Revises: a29fcc343fe2

His question, and it is the sharpest one he has asked about this feature:

    "some vendor will have 1 bottle - 30 piece... some vendor will have 1 bottle
     - 20 piece... how we gonna handle this confusion? This is very very serious
     one bro — not only bottle, this will be confusion for all the packs, box
     etc."

He is right that it is serious, and the model could not represent it at all.
`item_pack_levels` is keyed on the ITEM, so "bottle = 30 piece" was a property
of the lemon rather than of the supplier selling it. A vendor whose bottle holds
20 had two bad options: accept 30 and be wrong by ten pieces on every delivery,
or add a second rung called "bottle" to the item, which then shows up for
everybody.

Being wrong here is not cosmetic. Order one bottle from the 20-piece supplier,
receive it, and stock is credited 30 — a third of it never existed, and the
average cost per piece is wrong from then on.

So a vendor may now override the SIZE of the level they sell in, and nothing
else. The item still owns the chain — the names, the order, the default sizes —
because that is genuinely a property of the ingredient. Only "how many base
units MY bottle holds" belongs to the supplier. NULL keeps today's behaviour,
so nothing has to be re-entered.
"""

import sqlalchemy as sa

from alembic import op

revision = "1566c9435cb1"
down_revision = "a29fcc343fe2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendor_items",
        sa.Column(
            "pack_size_override",
            # Same precision as the chain's own `contains`, so a supplier's
            # bottle can be as exact as the item's.
            sa.Numeric(12, 3),
            nullable=True,
            comment="How many BASE units this vendor's pack holds, when it "
            "differs from the item's own chain. NULL = use the item's size.",
        ),
    )


def downgrade() -> None:
    op.drop_column("vendor_items", "pack_size_override")
