"""the pack chain: buy in a box, use a pinch

An item could describe exactly one buying size — `1 box = 15 kg` — because the
whole idea lived in two columns on `items`. Real kitchens nest:

    1 box = 10 small boxes, 1 small box = 30 packets, 1 packet = 50 g

so a box of pepper is 15 kg and also 300 packets, and the buyer wants to order
30 packets. Two columns cannot say that, and so purchasing could only ever
offer the one shape somebody chose when the item was created.

`item_pack_levels` is that chain: an ordered list per item, each row saying
"1 of me = `contains` of the level below me". Level 1's "below" is the base
unit on `items.unit`. Depth is not limited — three levels for pepper, one for a
sack of rice, none for loose tomatoes.

`vendor_items.pack_level_id` is the other half, and it is what makes this real:
suppliers do not all sell the same shape. One sells you the box, another only
packets. NULL keeps today's meaning — the price is per base unit — so every
existing row stays correct without being touched.

Both changes are additive. `items.pack_unit` / `pack_size` are deliberately
left alone: they are read as a one-level chain until the UI lands, so nothing
has to be re-entered and nothing breaks on the day this ships.

Revision ID: 2d26137a400a
Revises: 41433d120492
"""

import sqlalchemy as sa

from alembic import op

revision: str = "2d26137a400a"
down_revision: str | None = "41433d120492"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_pack_levels",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "item_id",
            sa.Uuid(),
            sa.ForeignKey("items.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        # 1 = the smallest buying size, sitting directly on the base unit.
        # Each higher position counts the level below it.
        sa.Column("position", sa.Integer(), nullable=False),
        # What a person calls it: "packet", "small box", "box", "crate".
        sa.Column("name", sa.String(40), nullable=False),
        # How many of the level below make one of these.
        sa.Column("contains", sa.Numeric(12, 3), nullable=False),
        sa.UniqueConstraint("item_id", "position", name="uq_item_pack_position"),
    )

    op.add_column(
        "vendor_items",
        sa.Column(
            "pack_level_id",
            sa.Uuid(),
            sa.ForeignKey("item_pack_levels.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("vendor_items", "pack_level_id")
    op.drop_table("item_pack_levels")
