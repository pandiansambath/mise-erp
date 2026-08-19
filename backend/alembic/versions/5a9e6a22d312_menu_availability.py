"""Out of stock, finished for today, not served — and serving hours.

Revision ID: 5a9e6a22d312
Revises: 7a31ae1f0116

    "super admin can delete the menu, delete any recipe, mark as out of stock,
     or over, or not served, only served at this particular time etc — all these
     kinda feature we need."

`is_available` was one boolean pretending to be four different facts, and they
behave differently:

  available        on the menu
  out_of_stock     temporarily gone; somebody puts it back when it arrives
  finished_today   gone until tomorrow; CLEARS ITSELF overnight, because
                   "we ran out of biryani" should not still be true on Tuesday
  not_served       off the menu but kept, so old orders still name it

And serving hours: breakfast until eleven, thali at lunch. A diner scanning at
three in the afternoon should not be offered a dosa the kitchen stopped making
at noon — and should be told when it is back, rather than simply not seeing it.
"""

import sqlalchemy as sa

from alembic import op

revision = "5a9e6a22d312"
down_revision = "7a31ae1f0116"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "menu_items",
        sa.Column("availability", sa.String(length=20), nullable=False, server_default="available"),
    )
    # The day `finished_today` was set, so it can expire on its own.
    op.add_column("menu_items", sa.Column("sold_out_on", sa.Date(), nullable=True))
    # Served only between these, hotel-local. NULL/NULL = served all day.
    op.add_column("menu_items", sa.Column("serve_from", sa.Time(), nullable=True))
    op.add_column("menu_items", sa.Column("serve_to", sa.Time(), nullable=True))

    # Carry the old boolean across so nothing changes the day this ships.
    op.execute(
        "UPDATE menu_items SET availability = 'not_served' WHERE is_available = false"
    )


def downgrade() -> None:
    op.drop_column("menu_items", "serve_to")
    op.drop_column("menu_items", "serve_from")
    op.drop_column("menu_items", "sold_out_on")
    op.drop_column("menu_items", "availability")
