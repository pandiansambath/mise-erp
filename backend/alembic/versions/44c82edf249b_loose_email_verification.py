"""Loosen email verification: let staff in, keep new-hotel owners strict.

His rule (2026-09-05):

    "for now we have a strict real email id, i mean they need to verify mail id
     before entering the dashboard. instead of this we need to make loose — let
     them enter, then verify the mail id. if they not verified mail id then
     don't allow them to use forget password or alerts, these are all paused
     until email id is verified, else it will create confusion... implement this
     loose for all logins EXCEPT the new hotel registration login (new hotel
     definitely need to verify on the spot so that we can send welcome mail to
     them etc, else suppose they give wrong mail id and we didn't verify means
     it will create so many real confusion)."

So verification stops being a wall for everyone and becomes a wall for exactly
one case. `verify_required` marks that case: it is set when a hotel signs itself
up, and nowhere else.

Existing rows are backfilled to preserve today's behaviour for owners rather
than silently loosening accounts that were created under the old rule: any
SUPER_ADMIN who has not verified yet keeps the wall.

Revision ID: 44c82edf249b
Revises: b9b2711a2776
"""
import sqlalchemy as sa

from alembic import op

revision: str = "44c82edf249b"
down_revision: str | None = "b9b2711a2776"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "verify_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Owners created under the strict rule keep it. Everyone else is loosened,
    # which is the point of the change.
    op.execute(
        "UPDATE users SET verify_required = TRUE "
        "WHERE role = 'SUPER_ADMIN' AND email_verified = FALSE"
    )


def downgrade() -> None:
    op.drop_column("users", "verify_required")
