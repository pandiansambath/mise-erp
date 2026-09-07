"""one shift per person per day per slot

Revision ID: 8407e01770df
Revises: c93367a6ccbb
Create Date: 2026-09-07

WHY A DATABASE CONSTRAINT AND NOT JUST A CHECK IN THE ENDPOINT.

The endpoint already refuses an identical shift — it lists the day and compares
before inserting. That guard is correct and it is also not enough, because it is
a read followed by a write with a gap in between. Two requests arriving together
both read "nothing there", and both insert. That is not a hypothetical: it is
what a double-click produces, and what the drag handler produced when one drop
fired twice.

  "i clicked 2 times (its accepting it) and in rota we can see 2 mohamed on same
   exact time."
  "here i moved 1 member from today to next day but it got duplicated."

A unique index closes the gap for good, because uniqueness is decided by the
database at write time and there is no interval to race in. The endpoint keeps
its check so the user gets a sentence instead of a 500.

The index cannot be created while duplicates exist, so this deletes them first —
keeping the earliest of each group, which is the one somebody actually meant.
That also cleans the rows already sitting on the live tenant, which is the point:
he can SEE the duplicates, so a fix that only prevents new ones leaves the bug on
his screen.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "8407e01770df"
down_revision: str | None = "c93367a6ccbb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX = "uq_shift_person_day_slot"


def upgrade() -> None:
    # Keep the earliest row of each identical group; drop the rest.
    # ctid is Postgres' physical row address — every row has one and it is
    # unique, so it breaks the tie without needing a sortable column.
    op.execute(
        """
        DELETE FROM shifts a
        USING shifts b
        WHERE a.hotel_id    = b.hotel_id
          AND a.employee_id = b.employee_id
          AND a.date        = b.date
          AND a.start_time  = b.start_time
          AND a.end_time    = b.end_time
          AND (a.created_at, a.ctid) > (b.created_at, b.ctid)
        """
    )
    op.create_index(
        INDEX,
        "shifts",
        ["hotel_id", "employee_id", "date", "start_time", "end_time"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(INDEX, table_name="shifts")
