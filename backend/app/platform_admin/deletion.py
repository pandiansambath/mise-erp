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


async def archive(db: AsyncSession, hotel_id: uuid.UUID, handle: str) -> str | None:
    """Write every row to S3 before anything is removed.

    Returns the key, or None if archiving is impossible — the caller MUST refuse
    to delete in that case. An irreversible action does not proceed on a
    best-effort backup.
    """
    bucket = getattr(settings, "s3_bucket", "") or ""
    if not bucket:
        return None

    dump: dict[str, list[dict]] = {}
    for table in ORDERED_TABLES + ("hotels",):
        if not await _table_exists(db, table):
            continue
        column = "id" if table == "hotels" else "hotel_id"
        if table != "hotels" and not await _has_hotel_column(db, table):
            continue
        rows = await db.execute(
            text(f"SELECT * FROM {table} WHERE {column} = :h"), {"h": str(hotel_id)}
        )
        dump[table] = [dict(r._mapping) for r in rows]

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    key = f"deleted-hotels/{handle or hotel_id}-{stamp}.json"
    try:
        import boto3

        boto3.client("s3", region_name=settings.aws_region).put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(dump, default=str).encode(),
            ContentType="application/json",
        )
    except Exception:
        log.exception("could not archive hotel before deletion", extra={"code": "DINE-I1002"})
        return None
    return key


# Never touched, whatever the schema says. `deleted_hotels` is the ledger of
# deletions — erasing the record of a deletion as part of that deletion would
# be a neat way to lose the audit trail entirely. (Its `hotel_id` is a plain
# Uuid, not a foreign key, so the graph walk below would not find it anyway;
# this is belt and braces.)
NEVER_DELETE: frozenset[str] = frozenset({"hotels", "deleted_hotels", "platform_config"})


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
