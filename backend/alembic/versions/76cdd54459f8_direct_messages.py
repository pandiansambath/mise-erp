"""One-to-one conversations, and the old staff thread moved into them.

    "one to one within the hotel — like any staff can chat with anyone, like
     organisation in teams"

The one-to-one thread already existed, as `staff_messages`, but it was a thread
between an EMPLOYEE RECORD and whoever could open that record. That shape had
two consequences. It lived at the bottom of an employee's page on an admin
screen, which is where he found it — "seriously worst place to keep". And a
kitchen manager or a cashier, who cannot open employee records, had no way to
message anybody at all.

So a direct conversation becomes a room like any other, between two USERS. That
gives it attachments, emoji, unread counts and a place in the room list for
free, because they are properties of rooms rather than of that one screen.

`dm_key` is the two user ids sorted and joined. Sorting makes it symmetrical, so
A→B and B→A are the same conversation rather than two half-empty ones, and the
unique index means two people opening each other in the same second cannot make
a pair of rooms that each hold half the history.

The old messages are carried across rather than left behind on a page nobody
will visit again.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "76cdd54459f8"
down_revision: str | None = "524b0f2e2ec2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_rooms", sa.Column("dm_key", sa.String(80), nullable=True))
    op.create_index("ix_chat_rooms_dm_key", "chat_rooms", ["dm_key"])
    # One room per pair, per hotel. Partial, because every other kind of room
    # leaves dm_key null and NULLs would otherwise all collide.
    op.create_index(
        "uq_direct_room_per_pair",
        "chat_rooms",
        ["hotel_id", "dm_key"],
        unique=True,
        postgresql_where=sa.text("dm_key IS NOT NULL"),
    )

    # ── carry the old staff ↔ manager thread across ──────────────────────────
    #
    # Only messages whose employee has a LOGIN can move: a direct room is
    # between two users, and an employee with no login is not one. Anything that
    # cannot be placed stays in staff_messages, which is left intact — this
    # migration adds, it does not delete, so a mistake here costs nothing.
    conn = op.get_bind()
    pairs = conn.execute(
        sa.text(
            """
            SELECT DISTINCT sm.hotel_id, e.user_id AS staff_user, sm.sender_user_id AS other_user
            FROM staff_messages sm
            JOIN employees e ON e.id = sm.employee_id
            WHERE e.user_id IS NOT NULL
              AND sm.sender_user_id IS NOT NULL
              AND sm.sender_user_id <> e.user_id
            """
        )
    ).fetchall()

    for hotel_id, staff_user, other_user in pairs:
        key = ":".join(sorted([str(staff_user), str(other_user)]))
        room_id = conn.execute(
            sa.text(
                "SELECT id FROM chat_rooms WHERE hotel_id = :h AND dm_key = :k"
            ),
            {"h": hotel_id, "k": key},
        ).scalar()
        if room_id is None:
            room_id = conn.execute(
                sa.text(
                    """
                    INSERT INTO chat_rooms (id, hotel_id, kind, name, dm_key, is_active, created_at)
                    VALUES (gen_random_uuid(), :h, 'direct', '', :k, true, now())
                    RETURNING id
                    """
                ),
                {"h": hotel_id, "k": key},
            ).scalar()
            for uid in (staff_user, other_user):
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO chat_room_members (id, room_id, user_id)
                        VALUES (gen_random_uuid(), :r, :u)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"r": room_id, "u": uid},
                )

        # Every message in that employee's thread belongs to this pair, whoever
        # sent it — the thread only ever had two ends.
        conn.execute(
            sa.text(
                """
                INSERT INTO chat_room_messages
                    (id, room_id, hotel_id, sender_user_id, sender_name, body, created_at)
                SELECT gen_random_uuid(), :r, sm.hotel_id, sm.sender_user_id,
                       COALESCE(u.preferred_name, split_part(u.email, '@', 1), 'Someone'),
                       sm.body, sm.created_at
                FROM staff_messages sm
                JOIN employees e ON e.id = sm.employee_id
                LEFT JOIN users u ON u.id = sm.sender_user_id
                WHERE e.user_id = :staff AND sm.body IS NOT NULL
                """
            ),
            {"r": room_id, "staff": staff_user},
        )
        conn.execute(
            sa.text(
                """
                UPDATE chat_rooms SET last_message_at = (
                    SELECT MAX(created_at) FROM chat_room_messages WHERE room_id = :r
                ) WHERE id = :r
                """
            ),
            {"r": room_id},
        )


def downgrade() -> None:
    op.drop_index("uq_direct_room_per_pair", table_name="chat_rooms")
    op.drop_index("ix_chat_rooms_dm_key", table_name="chat_rooms")
    op.drop_column("chat_rooms", "dm_key")
