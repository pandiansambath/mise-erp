"""A supplier may quote a box AND a loose kilo, at different rates.

Revision ID: 40c6a64f0525
Revises: 1566c9435cb1

His observation, and it is the last false assumption in the pricing model:

    "some vendor the 1 box price will be cheap — I mean the whole box if we
     bought means it's cheap. If we buy them in kg or g then price will be a bit
     vary... it's a marketing thing so that everyone will focus on buying box.
     But how are we gonna handle this situation? For now we auto calculating the
     kg value based on box total price."

We were DIVIDING a box price to get a per-kilo price. The trade prices the other
way round: the case is cheap precisely because it is a case, and buying two
kilos loose off the same supplier is usually dearer per kilo. So the divided
number is not a simplification, it is a rate nobody quoted — and it understated
the cost of every loose purchase.

    "some shop may have a compulsion to buy just 2kg only, they don't wish to
     buy 1 box, means we need to show based on that. That's why if we split and
     store that 1 item it will be useful nah."

Right. So a price now belongs to (vendor, item, FORM) rather than to
(vendor, item). One item still — dragon fruit is dragon fruit, one stock pool,
one average cost, one recipe ingredient. What multiplies is the way you can buy
it, which is a fact about the seller, exactly as the pack size turned out to be.

NULL pack_level_id means "sold loose, per base unit", and Postgres treats NULLs
as distinct in a unique constraint — so a single constraint over the triple
would happily allow five loose prices from one vendor. Two partial indexes give
what is actually meant: at most one loose price, and at most one price per pack.
"""

import sqlalchemy as sa

from alembic import op

revision = "40c6a64f0525"
down_revision = "1566c9435cb1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One row per vendor+item is exactly what has to stop being true.
    op.drop_constraint("uq_vendor_item", "vendor_items", type_="unique")

    # At most one price per (vendor, item, pack). Partial, because NULL is not
    # comparable and would slip past.
    op.create_index(
        "uq_vendor_item_pack",
        "vendor_items",
        ["vendor_id", "item_id", "pack_level_id"],
        unique=True,
        postgresql_where=sa.text("pack_level_id IS NOT NULL"),
    )
    # ...and at most one LOOSE price per (vendor, item).
    op.create_index(
        "uq_vendor_item_loose",
        "vendor_items",
        ["vendor_id", "item_id"],
        unique=True,
        postgresql_where=sa.text("pack_level_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_vendor_item_loose", table_name="vendor_items")
    op.drop_index("uq_vendor_item_pack", table_name="vendor_items")
    # Going back requires at most one row per vendor+item again; a database that
    # has since gained a second form for any pair cannot satisfy it, which is
    # correct — the constraint is the whole point.
    op.create_unique_constraint("uq_vendor_item", "vendor_items", ["vendor_id", "item_id"])
