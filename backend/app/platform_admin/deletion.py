"""Permanently deleting a restaurant.

The most destructive thing this software can do. A hotel row is the root of
everything that restaurant has ever recorded — every recipe, price, payslip,
till count and supplier invoice — and none of it can be reconstructed.

So the design assumes the operator is about to make a mistake:

**Nothing cascades.** All 34 foreign keys to `hotels.id` are plain references,
so a careless `DELETE FROM hotels` FAILS rather than quietly emptying the
database. That is deliberate and must stay that way: the safety comes from
deletion being hard, not from it being convenient. This module removes rows in
dependency order, explicitly, so the act is written down rather than implied by
a schema flag.

**You see what you are destroying first.** `preview()` counts the rows in every
table. "Delete Milagu?" is a question nobody can answer well; "delete 61 items,
1,204 sales lines and 38 payslips?" is.

**It is archived before it is deleted.** Everything is written to S3 first, so
"permanent" still has a way back for the ten minutes after somebody realises.
If the archive fails, the deletion does not happen — an irreversible act must
not proceed on a best-effort backup.

**The name must be typed.** Not a checkbox: a checkbox is muscle memory, typing
a name is a decision.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = logging.getLogger("mise.platform.deletion")

# ── WHY THIS LIST IS NO LONGER THE SOURCE OF TRUTH ────────────────────────
#
# It was, and it rotted, and deleting a hotel failed with a foreign-key error
# for any restaurant that had actually been used:
#
#   update or delete on table "hotels" violates constraint "chats_hotel_a_fkey"
#   update or delete on table "recipes" violates constraint "menu_items_..."
#
# Three separate faults, all of them the same underlying mistake — a
# hand-maintained mirror of the schema that nobody updates when the schema
# moves:
#
#  1. SIXTEEN TABLES were missing outright (`dining_tables`, `baskets`,
#     `table_messages`, `ai_usage`, `staff_posts`, `chat_rooms`, …). Every one
#     added after this list was written.
#  2. `chats` and `chat_messages` were listed but SILENTLY SKIPPED, because the
#     loop only deletes `WHERE hotel_id = …` and those tables call the column
#     `hotel_a` / `hotel_b` / `sender_hotel_id`. A hotel-to-hotel chat has two
#     owners, so it cannot have one `hotel_id`.
#  3. `recipes` was ordered BEFORE `menu_items`, but `menu_items.recipe_id`
#     points at `recipes.id`. The order claimed to be "deepest children first"
#     and simply was not.
#
# Which is why it worked for some restaurants and not others: an empty hotel
# has none of those rows. His report — "for some it's working, for some not" —
# was the schema drift showing through.
#
# `_delete_plan()` now reads the real foreign-key graph out of the database at
# runtime, so a table added tomorrow is handled tomorrow with no edit here.
# This list survives ONLY as a preferred ordering hint and as the set
# `preview()` shows the operator; anything it misses is still deleted.
ORDERED_TABLES: tuple[str, ...] = (
    # deepest children first
    "po_items",
    "purchase_orders",
    "indent_items",
    "indents",
    "vendor_item_aliases",
    "vendor_payments",
    "vendor_items",
    "price_history",
    "recipe_ingredients",
    "recipes",
    "dish_sales",
    "sales_lines",
    "petty_cash",
    "cash_events",
    "daily_sales",
    "sales_channels",
    "stock_movements",
    "items",
    "vendors",
    "expenses",
    "expense_categories",
    "attendance",
    "salary_advances",
    "payroll",
    "leaves",
    "shifts",
    "employees",
    "order_items",
    "orders",
    "menu_items",
    "job_applications",
    "job_postings",
    "talent_posts",
    "chat_messages",
    "chats",
    "assistant_messages",
    "assistant_threads",
    "documents",
    "document_requests",
    "safety_logs",
    "party_quote_lines",
    "party_quotes",
    "budget_targets",
    "audit_logs",
    "notifications",
    "custom_roles",
    "users",
)


async def _table_exists(db: AsyncSession, table: str) -> bool:
    row = await db.execute(
        text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{table}"}
    )
    return bool(row.scalar())


async def _has_hotel_column(db: AsyncSession, table: str) -> bool:
    row = await db.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = 'hotel_id'"
        ),
        {"t": table},
    )
    return row.first() is not None


async def preview(db: AsyncSession, hotel_id: uuid.UUID) -> dict:
    """What would be destroyed. Counts only — never touches a row.

    Shown to the operator before they can type the name, because the number is
    the only thing that conveys the weight of the action.
    """
    counts: dict[str, int] = {}
    # The SAME plan the purge will run, so the operator is shown the rows that
    # are genuinely about to go. Previously this counted `hotel_id` columns
    # only, so the confirmation under-reported every hotel-to-hotel chat and
    # every table added since the list was written.
    for table, where in await _delete_plan(db):
        n = (
            await db.execute(
                text(f"SELECT count(*) FROM {table} WHERE {where}"), {"h": str(hotel_id)}
            )
        ).scalar_one()
        if n:
            counts[table] = int(n)
    return {"counts": counts, "total_rows": sum(counts.values())}



# ── the snapshot store, behind two seams ───────────────────────────────────
#
# These exist so the wipe→restore round trip can be TESTED. It is the most
# important path in the product — the one thing standing between "he pressed
# the dangerous button" and "his restaurant is gone" — and with the boto3
# calls inline it could only ever be exercised by hand against real S3, which
# means in practice it would have been exercised for the first time by an
# owner who needed it.


def _put_snapshot(key: str, payload: dict) -> bool:
    """Write one snapshot. False if it did not land, for any reason."""
    bucket = getattr(settings, "s3_bucket", "") or ""
    if not bucket:
        return False
    try:
        import boto3

        boto3.client("s3", region_name=settings.aws_region).put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(payload, default=str).encode(),
            ContentType="application/json",
        )
    except Exception:
        log.exception("could not archive hotel before deletion", extra={"code": "DINE-I1002"})
        return False
    return True


def _get_snapshot(key: str) -> dict | None:
    """Read one snapshot back, or None if it cannot be read."""
    bucket = getattr(settings, "s3_bucket", "") or ""
    if not bucket:
        return None
    try:
        import boto3

        body = (
            boto3.client("s3", region_name=settings.aws_region)
            .get_object(Bucket=bucket, Key=key)["Body"]
            .read()
        )
        return json.loads(body)
    except Exception:
        log.exception("could not read snapshot", extra={"code": "DINE-I1004"})
        return None


async def archive(db: AsyncSession, hotel_id: uuid.UUID, handle: str) -> str | None:
    """Write every row to S3 before anything is removed.

    Returns the key, or None if archiving is impossible — the caller MUST refuse
    to delete in that case. An irreversible action does not proceed on a
    best-effort backup.
    """
    bucket = getattr(settings, "s3_bucket", "") or ""
    if not bucket:
        return None

    # ⚠️ THE SAME PLAN THE PURGE RUNS. Not `ORDERED_TABLES` — that is the
    # hand-typed list `preview` and `purge` both stopped using, and the gap
    # was silent: `audit_events` is deleted while the list names `audit_logs`,
    # and `chats`, `dining_tables`, `baskets` and `ai_usage` were deleted and
    # never saved at all. A backup that is a SUBSET of the delete is the worst
    # shape this can take, because it looks like it worked.
    #
    # The plan also carries the right WHERE per table: several are reached
    # through a parent and have no `hotel_id` of their own, so the old
    # `column = "hotel_id"` assumption skipped them even when they WERE listed.
    #
    # Saved in DELETE order (children first) and restored in reverse, so
    # parents exist before the rows that point at them.
    dump: dict[str, list[dict]] = {}
    plan = await _delete_plan(db)
    for table, where in plan:
        rows = await db.execute(
            text(f"SELECT * FROM {table} WHERE {where}"), {"h": str(hotel_id)}
        )
        dump[table] = [dict(r._mapping) for r in rows]

    rows = await db.execute(text("SELECT * FROM hotels WHERE id = :h"), {"h": str(hotel_id)})
    dump["hotels"] = [dict(r._mapping) for r in rows]

    # THE ORDER IS PART OF THE BACKUP. A restore that has to guess it will get
    # it wrong on a foreign key, and JSON object order is not something to
    # stake a recovery on.
    saved_order = [tbl for tbl, _w in plan] + ["hotels"]

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    key = f"deleted-hotels/{handle or hotel_id}-{stamp}.json"
    ok = _put_snapshot(
        key,
        {
            "version": 2,
            "hotel_id": str(hotel_id),
            "handle": handle,
            "taken_at": datetime.now(UTC).isoformat(),
            #: Delete order. Restore walks it BACKWARDS.
            "order": saved_order,
            "row_counts": {k: len(v) for k, v in dump.items()},
            "tables": dump,
        },
    )
    return key if ok else None



#: Never emptied by a wipe, as opposed to never deleted by a purge.
#:
#:     "it wont delete the owner login alone"
#:
#: (A role is a COLUMN on `users`, not a table — naming `roles`/`user_roles`
#: here would silently keep nothing and hide a real typo.)
#: The logins stay so he is still signed in afterwards, and `hotels` stays
#: because the restaurant still exists — it is just empty. `deleted_hotels`
#: and `hotel_transfers` are ledgers, and erasing the record of what happened
#: as part of making it happen is how an audit trail becomes fiction.
KEEP_ON_WIPE: frozenset[str] = frozenset({
    "users",
    "hotels",
    "deleted_hotels",
    "hotel_transfers",
    "platform_config",
})


async def wipe(db: AsyncSession, hotel_id: uuid.UUID, handle: str) -> dict:
    """Empty a restaurant, keeping its logins. Snapshot first, or refuse.

    Returns `{ok, key, removed}` — `key` is where the snapshot went, and it
    is what `restore` needs. A caller that gets `ok: False` must not have
    changed anything.
    """
    # THE SNAPSHOT IS NOT OPTIONAL AND IT GOES FIRST. `archive` returns None
    # when S3 is unconfigured or the upload fails; proceeding then would
    # produce exactly the outcome this feature exists to prevent.
    key = await archive(db, hotel_id, f"{handle or hotel_id}-wipe")
    if not key:
        return {
            "ok": False,
            "error": (
                "I could not take a snapshot first, so nothing was deleted. "
                "A wipe you cannot undo is not something this will do."
            ),
        }

    removed: dict[str, int] = {}
    for table, where in await _delete_plan(db):
        if table in KEEP_ON_WIPE:
            continue
        result = await db.execute(
            text(f"DELETE FROM {table} WHERE {where}"), {"h": str(hotel_id)}
        )
        if result.rowcount:
            removed[table] = int(result.rowcount)

    return {"ok": True, "key": key, "removed": removed}




async def snapshots(hotel_id: uuid.UUID, handle: str) -> list[dict]:
    """Every snapshot we hold that might belong to this restaurant.

    Listed by key prefix, which is the handle — so this is a CANDIDATE list,
    not a verified one. `restore` re-reads the file and refuses any snapshot
    whose `hotel_id` does not match, because a listing built from a filename
    is not evidence about what is inside the file.
    """
    bucket = getattr(settings, "s3_bucket", "") or ""
    if not bucket:
        return []
    prefix = f"deleted-hotels/{handle or hotel_id}"
    try:
        import boto3

        pages = (
            boto3.client("s3", region_name=settings.aws_region)
            .get_paginator("list_objects_v2")
            .paginate(Bucket=bucket, Prefix=prefix)
        )
        out: list[dict] = []
        for page in pages:
            for obj in page.get("Contents", []):
                out.append(
                    {
                        "key": obj["Key"],
                        "taken_at": obj["LastModified"].isoformat(),
                        "bytes": int(obj["Size"]),
                        # A wipe and a full delete write to the same place; the
                        # operator needs to know which one they are looking at.
                        "kind": "wipe" if "-wipe-" in obj["Key"] else "delete",
                    }
                )
    except Exception:
        log.exception("could not list snapshots", extra={"code": "DINE-I1005"})
        return []
    # Newest first: the one somebody wants back is almost always the last one.
    return sorted(out, key=lambda s: s["taken_at"], reverse=True)



def _as_text(value: object) -> str | None:
    """One saved value, as something Postgres can parse from text.

    JSON and array columns come back out of the snapshot as Python dicts and
    lists, and `str()` on those produces Python syntax — single quotes, `True`,
    `None` — which Postgres will not accept. They go back as JSON.
    """
    if value is None:
        return None
    if isinstance(value, dict | list):
        return json.dumps(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


async def _column_types(db: AsyncSession, table: str) -> dict[str, str]:
    """Each column's declared Postgres type, e.g. `{"created_at": "timestamp with time zone"}`.

    Needed because the snapshot is JSON. `json.dumps(..., default=str)` turns
    every timestamp, date, Decimal and UUID into a STRING, and asyncpg refuses
    a `str` where the prepared statement says `timestamptz` or `numeric` — so a
    naive INSERT of the saved rows fails on the first table that has a
    `created_at`, which is nearly all of them.

    Casting in SQL instead of guessing in Python means Postgres does the
    parsing it already knows how to do, and the restore does not carry a table
    of type conversions that drifts away from the schema.
    """
    rows = await db.execute(
        text(
            "SELECT attname, format_type(atttypid, atttypmod) AS coltype "
            "FROM pg_attribute "
            "WHERE attrelid = CAST(:t AS regclass) AND attnum > 0 AND NOT attisdropped"
        ),
        {"t": table},
    )
    return {r.attname: r.coltype for r in rows}


async def restore(db: AsyncSession, hotel_id: uuid.UUID, key: str) -> dict:
    """Put a snapshot back into a restaurant.

    PARENTS FIRST. The snapshot records the DELETE order — children first —
    so this walks it backwards. Inserting a child before its parent fails on
    a foreign key, and a restore that half-works is worse than one that
    refuses, because the half that arrived looks like the whole thing.

    IT REFUSES TO RESTORE OVER LIVE DATA. Somebody who wiped, carried on
    working, and then restored would get two of everything with no way to
    tell which was which. Empty first, or do not restore.
    """
    snap = _get_snapshot(key)
    if snap is None:
        return {"ok": False, "error": "That snapshot could not be read."}

    if snap.get("version") != 2:
        return {
            "ok": False,
            "error": "That snapshot is in an older format this cannot restore.",
        }
    if str(snap.get("hotel_id")) != str(hotel_id):
        # Restoring one restaurant's data into another is the single worst
        # thing this function could do, so it is checked rather than assumed.
        return {"ok": False, "error": "That snapshot belongs to a different restaurant."}

    tables: dict[str, list[dict]] = snap.get("tables") or {}
    order: list[str] = snap.get("order") or list(tables)

    # NOT OVER LIVE DATA.
    for table in order:
        if table in KEEP_ON_WIPE:
            continue
        # Only tables that carry `hotel_id` can be counted this way; the rest
        # are reached through a parent, and emptying the parent empties them.
        if not await _table_exists(db, table) or not await _has_hotel_column(db, table):
            continue
        n = (
            await db.execute(
                text(f"SELECT count(*) FROM {table} WHERE hotel_id = :h"),
                {"h": str(hotel_id)},
            )
        ).scalar_one()
        if n:
            return {
                "ok": False,
                "error": (
                    f"There is already data here ({table}). Restoring on top "
                    "would give you two of everything with no way to tell "
                    "them apart."
                ),
            }

    put: dict[str, int] = {}
    # Reversed: the snapshot is in DELETE order, children first.
    for table in reversed(order):
        if table in KEEP_ON_WIPE:
            continue
        rows = tables.get(table) or []
        if not rows:
            continue
        if not await _table_exists(db, table):
            # The schema moved on since the snapshot. Skipped and REPORTED —
            # silently dropping a table would make the restore look complete.
            put[f"{table} (gone)"] = 0
            continue
        types = await _column_types(db, table)
        # Columns the snapshot has that the table no longer does are DROPPED
        # rather than sent — a schema that moved on must not fail the whole
        # restore over a field nobody uses any more.
        cols = [c for c in rows[0] if c in types]
        dropped = [c for c in rows[0] if c not in types]
        names = ", ".join(f'"{c}"' for c in cols)
        # EVERY VALUE GOES IN AS TEXT AND IS CAST BY POSTGRES. See
        # `_column_types` — the snapshot is JSON, so a timestamp is a string
        # by the time it gets here and asyncpg will not encode a string as a
        # timestamptz.
        binds = ", ".join(f'CAST(:{c} AS {types[c]})' for c in cols)
        stmt = text(f'INSERT INTO {table} ({names}) VALUES ({binds})')
        for row in rows:
            await db.execute(stmt, {c: _as_text(row[c]) for c in cols})
        put[table] = len(rows)
        if dropped:
            put[f"{table} (fields no longer in the schema)"] = len(dropped)

    return {"ok": True, "restored": put}

# Never touched, whatever the schema says. `deleted_hotels` is the ledger of
# deletions — erasing the record of a deletion as part of that deletion would
# be a neat way to lose the audit trail entirely. (Its `hotel_id` is a plain
# Uuid, not a foreign key, so the graph walk below would not find it anyway;
# this is belt and braces.)
NEVER_DELETE: frozenset[str] = frozenset({
    "hotels",
    "deleted_hotels",
    "platform_config",
    # The transfer ledger, for the same reason as `deleted_hotels`. Its
    # `hotel_id` is a plain Uuid so the walk cannot reach it that way — but
    # `requested_by` IS a foreign key to `users`, which IS reachable, so
    # without this line deleting a restaurant quietly erases the record of
    # who it was offered to and when. That record is the answer to "what
    # happened to my restaurant", which is the question it exists for.
    "hotel_transfers",
})


HotelCols = dict[str, set[str]]
Edges = dict[str, list[tuple[str, str, str]]]


async def _fk_graph(db: AsyncSession) -> tuple[HotelCols, Edges]:
    """The database's real foreign keys.

    Returns `(hotel_cols, edges)` where

      hotel_cols[table]  = column names on `table` that reference `hotels.id`
      edges[table]       = [(column, parent_table, parent_column), …]

    Read from `information_schema` rather than from our models, because the
    thing we need to be true is what the DATABASE will enforce at DELETE time.
    A model that has drifted from a migration would lie to us here in exactly
    the way that caused this bug.
    """
    rows = await db.execute(
        text(
            """
            SELECT tc.table_name      AS child,
                   kcu.column_name    AS child_col,
                   ccu.table_name     AS parent,
                   ccu.column_name    AS parent_col
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = tc.constraint_name
             AND kcu.table_schema    = tc.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema    = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema    = 'public'
            """
        )
    )
    hotel_cols: HotelCols = {}
    edges: Edges = {}
    for child, child_col, parent, parent_col in rows:
        if child in NEVER_DELETE:
            continue
        if parent == "hotels":
            hotel_cols.setdefault(child, set()).add(child_col)
        else:
            edges.setdefault(child, []).append((child_col, parent, parent_col))
    return hotel_cols, edges


def _predicate(
    table: str,
    hotel_cols: HotelCols,
    edges: Edges,
    doomed: set[str],
    seen: frozenset[str] = frozenset(),
) -> str | None:
    """The WHERE clause selecting `table`'s rows that belong to this hotel.

    Two ways a row can belong:

      DIRECTLY   — it has a column pointing at `hotels.id`. Covers `hotel_id`,
                   and equally `chats.hotel_a` / `chats.hotel_b`, which is the
                   case the old column-name assumption missed.

      BY PARENT  — it points at a row that is itself being deleted. This is not
                   optional: a chat between hotel A and hotel B holds messages
                   whose `sender_hotel_id` is B. Deleting A by column alone
                   leaves B's messages behind, still pointing at a chat that is
                   about to vanish, and the whole transaction fails.

    `seen` breaks self-references and cycles (a table that points at itself, or
    a pair that point at each other) — without it this recurses forever.
    """
    if table in seen:
        return None
    seen = seen | {table}
    parts = [f"{c} = :h" for c in sorted(hotel_cols.get(table, ()))]
    for col, parent, parent_col in edges.get(table, []):
        if parent not in doomed or parent == table:
            continue
        inner = _predicate(parent, hotel_cols, edges, doomed, seen)
        if inner:
            parts.append(f"{col} IN (SELECT {parent_col} FROM {parent} WHERE {inner})")
    return " OR ".join(parts) if parts else None


def _order(doomed: set[str], edges: Edges) -> list[str]:
    """Children before parents, so no delete strands a reference.

    A depth-first post-order over the FK graph. Where the graph is cyclic the
    cycle is broken arbitrarily; Postgres will complain if that turns out to
    matter, and a failed delete is the safe direction.

    `ORDERED_TABLES` still seeds the traversal order so the common case comes
    out in the sequence somebody reviewing the code would expect.
    """
    out: list[str] = []
    done: set[str] = set()
    busy: set[str] = set()

    def visit(tbl: str) -> None:
        if tbl in done or tbl in busy or tbl not in doomed:
            return
        busy.add(tbl)
        # Anything pointing AT me has to go first.
        for child, links in edges.items():
            if child in doomed and any(p == tbl for _c, p, _pc in links):
                visit(child)
        busy.discard(tbl)
        done.add(tbl)
        out.append(tbl)

    for tbl in ORDERED_TABLES:
        visit(tbl)
    for tbl in sorted(doomed):
        visit(tbl)
    return out


async def _delete_plan(db: AsyncSession) -> list[tuple[str, str]]:
    """`[(table, where_clause), …]`, children first. Derived, never hand-typed."""
    hotel_cols, edges = await _fk_graph(db)

    # Everything reachable from `hotels` — directly, or through a parent that
    # is itself reachable. Grown to a fixed point so a great-grandchild three
    # tables down is still found.
    doomed: set[str] = set(hotel_cols)
    changed = True
    while changed:
        changed = False
        for child, links in edges.items():
            if child in doomed or child in NEVER_DELETE:
                continue
            if any(p in doomed for _c, p, _pc in links):
                doomed.add(child)
                changed = True

    plan: list[tuple[str, str]] = []
    for tbl in _order(doomed, edges):
        where = _predicate(tbl, hotel_cols, edges, doomed)
        if where:
            plan.append((tbl, where))
    return plan


async def purge(db: AsyncSession, hotel_id: uuid.UUID) -> dict[str, int]:
    """Remove every row, children first, then the hotel.

    One transaction: a half-deleted restaurant — users gone but sales left
    behind — is worse than a failed delete, because nothing would ever clean it
    up and the orphans reference a hotel that no longer exists.
    """
    removed: dict[str, int] = {}
    for table, where in await _delete_plan(db):
        result = await db.execute(
            text(f"DELETE FROM {table} WHERE {where}"), {"h": str(hotel_id)}
        )
        if result.rowcount:
            removed[table] = int(result.rowcount)
    result = await db.execute(text("DELETE FROM hotels WHERE id = :h"), {"h": str(hotel_id)})
    removed["hotels"] = int(result.rowcount or 0)
    return removed
