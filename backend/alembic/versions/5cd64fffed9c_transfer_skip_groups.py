"""what he chose to leave behind, stored with the request

    "show preview...before hte final confirmaiton like waht and all are
     there...if user wish to remove anytung he can do that"

Handing over a restaurant is the least reversible thing this product does,
and the screen asking for it said "everything" — which is not a preview, it
is a promise nobody can check. The preview now counts what would go, grouped
the way a restaurant thinks rather than the way the database does, and the
optional groups can be left behind.

STORED ON THE REQUEST, not recomputed when it executes. Days pass between
asking and accepting; recomputing would mean the transfer carries whatever
the defaults happen to be on the day it completes, which could be more than
was shown to either side. A transfer that quietly carries more than was
agreed is the precise failure this preview exists to prevent.

NULLABLE, with no default. An existing outstanding request predates the
preview and therefore agreed to everything — which is what `None` means at
the read site. A server_default of '[]' would say the same thing less
clearly, and this column is read exactly once.

Revision ID: 5cd64fffed9c
Revises: e8cc97540ecd
"""

import sqlalchemy as sa

from alembic import op

revision = "5cd64fffed9c"
down_revision = "e8cc97540ecd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hotel_transfers", sa.Column("skip_groups", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("hotel_transfers", "skip_groups")
