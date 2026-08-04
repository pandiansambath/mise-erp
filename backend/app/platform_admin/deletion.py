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

# Child tables in the order they must be emptied: anything that references
# another child comes first. Getting this wrong surfaces as a foreign-key error
# and aborts the transaction, which is the safe direction — a half-deleted hotel
# is worse than a failed delete.
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
    for table in ORDERED_TABLES:
        if not await _table_exists(db, table) or not await _has_hotel_column(db, table):
            continue
        n = (
            await db.execute(
                text(f"SELECT count(*) FROM {table} WHERE hotel_id = :h"), {"h": str(hotel_id)}
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


async def purge(db: AsyncSession, hotel_id: uuid.UUID) -> dict[str, int]:
    """Remove every row, children first, then the hotel.

    One transaction: a half-deleted restaurant — users gone but sales left
    behind — is worse than a failed delete, because nothing would ever clean it
    up and the orphans reference a hotel that no longer exists.
    """
    removed: dict[str, int] = {}
    for table in ORDERED_TABLES:
        if not await _table_exists(db, table) or not await _has_hotel_column(db, table):
            continue
        result = await db.execute(
            text(f"DELETE FROM {table} WHERE hotel_id = :h"), {"h": str(hotel_id)}
        )
        if result.rowcount:
            removed[table] = int(result.rowcount)
    result = await db.execute(text("DELETE FROM hotels WHERE id = :h"), {"h": str(hotel_id)})
    removed["hotels"] = int(result.rowcount or 0)
    return removed
