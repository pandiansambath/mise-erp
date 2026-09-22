"""Copying a whole restaurant to another account.

    "1.move one hotel from one email to other email 2. COPY one hotel
     datas(litrelly eevrything from one email to othere new email"

THE COPY IS THE DELETE, RUN FORWARDS.

`deletion._delete_plan` already answers the only hard question here: which
tables belong to a hotel, and in what order do they depend on each other. It
answers it from the LIVE FOREIGN KEY GRAPH rather than a hand-typed list,
because the hand-typed list drifted and silently under-reported every table
added after somebody last edited it — twice, in two different functions.

So this file does not get its own list. It walks the same plan BACKWARDS
(parents before children, the reverse of delete order) and inserts a copy of
every row with a fresh id.

WHAT MAKES THIS DIFFERENT FROM A BACKUP RESTORE
--------------------------------------------------------------------------
Every primary key is reminted, and every foreign key pointing INSIDE the copy
has to be rewritten to the new id. A row that still points at the original
restaurant's vendor is not a copy — it is a cross-tenant link, which is the
one category of bug this product cannot ship. So:

  * one `remap` dict, `(table, old_id) -> new_id`, built as we go;
  * parents are inserted first, so by the time a child is written every id it
    references is already in the map;
  * a foreign key we cannot resolve is NULLED if the column allows it and the
    ROW IS DROPPED if it does not — never left pointing at the source.

WHAT IS DELIBERATELY NOT COPIED
--------------------------------------------------------------------------
`users` — the new owner is created by the caller with their own email and
their own password. Copying a password hash to a second account means two
people can sign in to a restaurant with one credential, and neither can tell.

Audit and usage history stay with the original. A copy has not done anything
yet, and a fresh restaurant inheriting somebody else's audit trail makes the
trail useless for both.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.platform_admin.deletion import _delete_plan, _fk_graph

log = logging.getLogger("mise.platform.cloning")

#: Never carried into a copy. See the module docstring — each of these is a
#: deliberate refusal, not an oversight.
DO_NOT_COPY: frozenset[str] = frozenset({
    "users",            # the new owner signs in as themselves
    # ⚠️ A COPY INHERITS NO INVITATIONS, AND THIS IS NOT TIDINESS.
    #
    # `hotel_transfers.requested_by` is a foreign key to `users`, and `users`
    # is reachable from `hotels` — so the graph walk pulled this table into
    # the copy, and the copy duplicated THE VERY INVITATION THAT CREATED IT,
    # `accept_token` and all. The unique index caught it, which is the only
    # reason it is not shipping: a second row bearing a live accept link,
    # pointing at a restaurant nobody meant to offer.
    "hotel_transfers",
    "audit_events",     # a copy has not done anything yet
    "ai_usage",         # nor has it spent anything
    "ai_threads",
    "assistant_threads",
    "assistant_messages",
    "chats",            # hotel-to-hotel conversations belong to the original
    "chat_messages",
    "deleted_hotels",
    "platform_config",
    "email_events",
    "password_resets",
})

#: Columns that must never be carried over verbatim even on a copied table.
#: `created_at` is left alone — when the original row was made is a fact.
RESET_COLUMNS: frozenset[str] = frozenset({"verify_token", "reset_token"})


async def _columns(db: AsyncSession, table: str) -> dict[str, bool]:
    """`{column: is_nullable}` for one table."""
    rows = await db.execute(
        text(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = :t
            """
        ),
        {"t": table},
    )
    return {r[0]: (r[1] == "YES") for r in rows}


async def plan_copy(db: AsyncSession) -> list[tuple[str, str]]:
    """Tables to copy, PARENTS FIRST — the delete plan reversed.

    `_delete_plan` returns children first because that is the safe order to
    remove rows. Inserting them needs the opposite, so that every foreign key
    a child carries has already been reminted by the time we write it.
    """
    plan = await _delete_plan(db)
    return [(t, w) for t, w in reversed(plan) if t not in DO_NOT_COPY]


async def copy_hotel(
    db: AsyncSession, source_id: uuid.UUID, target_id: uuid.UUID
) -> dict[str, int]:
    """Copy every row of `source_id` onto the already-created `target_id`.

    The target hotel row must exist — the caller creates it, because the new
    restaurant's name, handle and owner are decisions, not copies.

    Returns `{table: rows copied}`. Runs inside the caller's transaction so a
    failure leaves nothing behind: a half-copied restaurant is worse than a
    failed copy, because it looks like a real one.
    """
    hotel_cols, edges = await _fk_graph(db)
    remap: dict[tuple[str, Any], Any] = {}
    copied: dict[str, int] = {}

    for table, where in await plan_copy(db):
        cols = await _columns(db, table)
        if "id" not in cols:
            # A pure join table with no surrogate key. Its foreign keys are
            # remapped like any other row; there is simply no id to mint.
            log.info("copying keyless table %s", table)

        rows = (
            await db.execute(text(f"SELECT * FROM {table} WHERE {where}"), {"h": str(source_id)})
        ).mappings().all()
        if not rows:
            continue

        # Which of this table's columns point where, so each value is treated
        # the right way exactly once.
        hotel_ref = hotel_cols.get(table, set())
        parents = {col: parent for col, parent, _pc in edges.get(table, [])}

        written = 0
        for row in rows:
            values: dict[str, Any] = {}
            drop = False

            for col, val in row.items():
                if col in RESET_COLUMNS:
                    values[col] = None
                    continue
                if col == "id":
                    values[col] = uuid.uuid4()
                    remap[(table, val)] = values[col]
                    continue
                if col in hotel_ref:
                    # EVERY reference to the source hotel becomes the target.
                    values[col] = target_id
                    continue
                parent = parents.get(col)
                if parent and val is not None:
                    new = remap.get((parent, val))
                    if new is not None:
                        values[col] = new
                    elif parent in DO_NOT_COPY or cols.get(col, True):
                        # We are not carrying the parent (a user id on an
                        # audit-ish column, say). NULL is honest; pointing at
                        # the original restaurant's row is not.
                        values[col] = None
                    else:
                        # NOT NULL and unresolvable — the row cannot exist in
                        # the copy without lying about what it references.
                        drop = True
                        break
                    continue
                values[col] = val

            if drop:
                continue

            names = ", ".join(values)
            binds = ", ".join(f":{c}" for c in values)
            await db.execute(text(f"INSERT INTO {table} ({names}) VALUES ({binds})"), values)
            written += 1

        if written:
            copied[table] = written

    return copied
