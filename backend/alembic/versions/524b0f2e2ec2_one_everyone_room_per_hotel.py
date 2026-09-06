"""One Everyone room per hotel, and one Managers room, enforced by the database.

The standing rooms are created lazily, on the first request that lists rooms.
That is the right moment — a hotel that never opens chat should carry no rows
for it — but it means two people opening the page in the same second both find
no Everyone room and both create one. The result is two rooms with the same
name, the conversation split down the middle, and no obvious way to tell which
half anybody is reading.

A check-then-insert cannot fix this in application code; only the database can
decide who was first. The index is partial because custom groups are allowed to
share a name and a kind freely — the constraint is about the two rooms whose
identity is fixed, not about groups the owner invents.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "524b0f2e2ec2"
down_revision: str | None = "6b05ce5f332d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Deduplicate first: on a box where the race already happened, the index
    # would refuse to build and take the deploy down with it. Keep the oldest
    # room of each kind, and move any messages and reads from its twins onto it
    # so no conversation is lost.
    op.execute(
        """
        WITH keep AS (
            SELECT DISTINCT ON (hotel_id, kind) id, hotel_id, kind
            FROM chat_rooms
            WHERE kind IN ('everyone', 'managers')
            ORDER BY hotel_id, kind, created_at
        ),
        dupes AS (
            SELECT r.id AS dupe_id, k.id AS keep_id
            FROM chat_rooms r
            JOIN keep k ON k.hotel_id = r.hotel_id AND k.kind = r.kind
            WHERE r.kind IN ('everyone', 'managers') AND r.id <> k.id
        )
        UPDATE chat_room_messages m
        SET room_id = d.keep_id
        FROM dupes d
        WHERE m.room_id = d.dupe_id
        """
    )
    # Reads are per person per room and would collide on the unique constraint,
    # so the losing rows are simply dropped: the worst case is one room showing
    # as unread again for someone who had already looked at its twin.
    op.execute(
        """
        DELETE FROM chat_room_reads
        WHERE room_id IN (
            SELECT r.id FROM chat_rooms r
            JOIN (
                SELECT DISTINCT ON (hotel_id, kind) id, hotel_id, kind
                FROM chat_rooms
                WHERE kind IN ('everyone', 'managers')
                ORDER BY hotel_id, kind, created_at
            ) k ON k.hotel_id = r.hotel_id AND k.kind = r.kind
            WHERE r.kind IN ('everyone', 'managers') AND r.id <> k.id
        )
        """
    )
    op.execute(
        """
        DELETE FROM chat_rooms r
        USING (
            SELECT DISTINCT ON (hotel_id, kind) id, hotel_id, kind
            FROM chat_rooms
            WHERE kind IN ('everyone', 'managers')
            ORDER BY hotel_id, kind, created_at
        ) k
        WHERE k.hotel_id = r.hotel_id
          AND k.kind = r.kind
          AND r.kind IN ('everyone', 'managers')
          AND r.id <> k.id
        """
    )
    op.create_index(
        "uq_standing_room_per_hotel",
        "chat_rooms",
        ["hotel_id", "kind"],
        unique=True,
        postgresql_where=sa.text("kind IN ('everyone', 'managers')"),
    )


def downgrade() -> None:
    op.drop_index("uq_standing_room_per_hotel", table_name="chat_rooms")
