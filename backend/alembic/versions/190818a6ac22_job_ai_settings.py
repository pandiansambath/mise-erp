"""What the AI may do, set on the JOB rather than on each person.

    "i said u to add ai related role toggles too nah. u said u added, but
     where? i can see here" — looking at the per-JOB sheet.

He was right. The AI panel existed, on the per-PERSON sheet, which is the
exception rather than the rule: "so manager means what and all he can access,
super admin can choose this" is a sentence about a job. Setting the model, the
voice and the caps once per role is the difference between a setting and a
chore, and it mirrors how permissions already work here — the job carries the
default, a person's own settings win over it.

Empty means "the hotel's defaults", which is why the column defaults to {} and
not to a filled-in policy: a hotel that never opens this screen should behave
exactly as it does today.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "190818a6ac22"
down_revision: str | None = "76cdd54459f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "role_defaults",
        sa.Column("ai_settings", sa.JSON(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("role_defaults", "ai_settings")
