"""Team chat inside one hotel: Everyone, Managers, and custom groups.

    "inside hotel a grp chat i need... all in that chat they can message, send
     gif, emojis, pic, video etc... another side, we need a grp chat for super
     admin + manager roles alone... also i need one customisable grp creation
     feature like superadmin can decide to create a grp and add members"

THREE KINDS, ONE TABLE. "Everyone" and "Managers" have no member rows — their
membership is a RULE, evaluated live from each person's role. That matters
beyond tidiness: with member rows, hiring someone would silently leave them out
of Everyone until an admin remembered to add them, and promoting a chef to
manager would not let them into Managers. A rule cannot be forgotten.

Custom groups do have member rows, because "whichever he wish" is a list, not a
rule.

Reads are per person per room, which is the only way an unread badge can be
right for two people looking at the same room.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "6b05ce5f332d"
down_revision: str | None = "d18108501a62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_rooms",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        # "everyone" | "managers" | "custom"
        sa.Column("kind", sa.String(16), nullable=False, server_default="custom"),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("emoji", sa.String(8), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # Only custom rooms use these; the two standing rooms are membership by rule.
    op.create_table(
        "chat_room_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "room_id",
            sa.Uuid(),
            sa.ForeignKey("chat_rooms.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.UniqueConstraint("room_id", "user_id", name="uq_room_member"),
    )
    op.create_table(
        "chat_room_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "room_id",
            sa.Uuid(),
            sa.ForeignKey("chat_rooms.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("sender_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        # Kept as a name too, so the history still reads after a login is
        # removed. A thread that decays into "unknown said" is one nobody trusts.
        sa.Column("sender_name", sa.String(120), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        # Pictures, video and GIFs. Stored like every other upload; the row only
        # remembers where it went and what it was.
        sa.Column("attachment_key", sa.String(500), nullable=True),
        sa.Column("attachment_name", sa.String(255), nullable=True),
        sa.Column("attachment_type", sa.String(80), nullable=True),
        sa.Column("attachment_size", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            index=True,
        ),
    )
    # Per person per room, because two people reading the same room have
    # different ideas of what is new.
    op.create_table(
        "chat_room_reads",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "room_id",
            sa.Uuid(),
            sa.ForeignKey("chat_rooms.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("room_id", "user_id", name="uq_room_read"),
    )


def downgrade() -> None:
    op.drop_table("chat_room_reads")
    op.drop_table("chat_room_messages")
    op.drop_table("chat_room_members")
    op.drop_table("chat_rooms")
