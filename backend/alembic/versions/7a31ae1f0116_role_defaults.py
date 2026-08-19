"""Set what a JOB reaches once, instead of per person forever.

Revision ID: 7a31ae1f0116
Revises: 8eaf4aafbbcf

    "you gave for each page access, fine... but it will make the job tough for
     layman that they need to keep on doing this. So manager means what and all
     he can access — read only or write only or both — also here whatever pages
     we have in our superadmin screen, based on manager's access he needs to see
     all. Don't miss any. Super admin can choose this... so please don't
     restrict any, let super admin do anything he wants."

Two things in that, and both are right.

ONE: per-person was the wrong unit of work. Answering "what can a manager do"
once and having every manager inherit it is the difference between a setting
and a chore. Per-person editing stays — it is how you handle the exception —
but it stops being the only door.

TWO: the archetype ENVELOPE has to stop being a wall. It exists to make an
unsafe grant unrepresentable, which is a good instinct and the wrong owner: the
person hitting it is the one who bought the software and is telling us what
their manager does. It becomes a WARNING in the UI rather than a silent clip.

`permissions` is the whole list rather than a diff against the code's defaults,
because a hotel that has said what a manager does should not have that answer
change underneath them when we ship a new default.
"""

import sqlalchemy as sa

from alembic import op

revision = "7a31ae1f0116"
down_revision = "8eaf4aafbbcf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "role_defaults",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        # MANAGER, KITCHEN_MANAGER, ACCOUNTANT, CASHIER, STAFF.
        sa.Column("base_role", sa.String(length=32), nullable=False),
        # The complete list this job reaches at this hotel.
        sa.Column("permissions", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["hotel_id"], ["hotels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hotel_id", "base_role", name="uq_role_default"),
    )
    op.create_index("ix_role_defaults_hotel_id", "role_defaults", ["hotel_id"])


def downgrade() -> None:
    op.drop_index("ix_role_defaults_hotel_id", table_name="role_defaults")
    op.drop_table("role_defaults")
