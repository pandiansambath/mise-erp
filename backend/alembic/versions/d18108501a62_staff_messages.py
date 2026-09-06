"""Staff ↔ owner messages: a persistent thread per employee.

    "here i want one comment kinda feature. staff can comment that owner can
     see, owner can comment that staff can see here. they even can chat like
     whatsapp. make this chat history persistent"

Its OWN table rather than reusing `chats`. That one is hotel_a/hotel_b — two
different restaurants talking on the talent board. This is a person inside one
restaurant talking to their manager, and forcing it into that shape would mean a
hotel messaging itself, with no way to say WHICH person the thread is about.

The employee IS the thread, so there is no separate thread row: one table of
messages keyed by employee, plus two "last seen" timestamps on the employee for
unread counts. That trades a little normalisation for one fewer join on a query
that runs on every poll.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "d18108501a62"
down_revision: str | None = "6360e05b9e34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True
        ),
        sa.Column(
            "employee_id",
            sa.Uuid(),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        # Who typed it. Kept as a NAME as well as an id so the history still
        # reads correctly after someone's login is removed — a thread that turns
        # into "unknown said" is a thread nobody trusts.
        sa.Column("sender_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("sender_name", sa.String(120), nullable=False),
        # Which side of the conversation, so the bubbles land correctly for
        # whoever is reading — the staff member and the manager both see their
        # own words on the right.
        sa.Column("from_staff", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            index=True,
        ),
    )
    # Unread = messages from the other side newer than my last look.
    op.add_column(
        "employees", sa.Column("msg_seen_staff_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "employees", sa.Column("msg_seen_owner_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("employees", "msg_seen_owner_at")
    op.drop_column("employees", "msg_seen_staff_at")
    op.drop_table("staff_messages")
