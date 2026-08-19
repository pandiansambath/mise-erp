"""An order line can name WHICH way it is being bought.

Revision ID: 2d320918a015
Revises: 40c6a64f0525

A supplier may quote a case and a loose kilo at rates that are not multiples of
each other. The line already recorded WHO it is coming from; it could not
record WHICH of their forms, so the server fell back to that supplier's
cheapest — right nearly always, and impossible to override when it is not.

The case where it matters is the one he described: a kitchen that wants two
kilos and does not want the case. Cheapest-per-kilo says take the case; the
person ordering knows better and now has somewhere to say so.

NULL means "let the server choose", which is what every existing line means and
what almost every line should go on meaning.
"""

import sqlalchemy as sa

from alembic import op

revision = "2d320918a015"
down_revision = "40c6a64f0525"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "indent_items",
        sa.Column(
            "pack_level_id",
            sa.Uuid(),
            nullable=True,
            comment="Which form of the supplier's price this line buys. "
            "NULL = let the server pick their cheapest.",
        ),
    )
    op.create_foreign_key(
        "fk_indent_items_pack_level",
        "indent_items",
        "item_pack_levels",
        ["pack_level_id"],
        ["id"],
        # The rung going away must not take the order line with it; the line
        # simply reverts to "let the server choose".
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_indent_items_pack_level", "indent_items", type_="foreignkey")
    op.drop_column("indent_items", "pack_level_id")
