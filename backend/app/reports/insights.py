"""Money Intelligence — read-only insights that turn the data we already collect
into profit decisions. No new tables; everything is composed from inventory,
recipes, expenses, sales and purchase-order history.

Pieces:
  • stock_value      — £ sitting on the shelves (Σ stock × weighted-avg cost), by category
  • break_even       — fixed costs ÷ contribution margin → the sales you must hit
  • dish_margins     — best / worst GP% dishes + ones with no selling price set
  • price_alerts     — items whose *actually-paid* price (PO receipts) is climbing

NOTE: sales are recorded per channel, not per dish, so true menu-engineering
(popularity × margin) and per-dish theoretical variance need a POS feed or a
manual dish-count entry — out of scope here. These all need zero new data entry.
"""
import uuid
from collections import defaultdict
from datetime import date as date_type
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import Item, MovementType, StockMovement
from app.recipes import service as recipe_service
from app.reports import service as reports_service

_Q2 = Decimal("0.01")


def _q2(value: Decimal | None) -> Decimal:
    return (value or Decimal("0")).quantize(_Q2, ROUND_HALF_UP)


async def stock_value(db: AsyncSession, hotel_id: uuid.UUID) -> dict:
    """£ value of stock on hand at weighted-average cost, grouped by category."""
    rows = await db.execute(
        select(
            Item.category,
            func.coalesce(func.sum(Item.current_stock * Item.average_cost), 0),
            func.count(),
        )
        .where(Item.hotel_id == hotel_id, Item.is_active.is_(True))
        .group_by(Item.category)
    )
    by_category: list[dict] = []
    total = Decimal("0")
    item_count = 0
    for category, value, count in rows.all():
        val = _q2(value)
        by_category.append({"category": category or "Uncategorised", "value": val})
        total += val
        item_count += count
    by_category.sort(key=lambda c: c["value"], reverse=True)
    return {"total": _q2(total), "by_category": by_category, "item_count": item_count}


async def dish_margins(db: AsyncSession, hotel_id: uuid.UUID, *, top: int = 5) -> dict:
    """Rank dishes by stored gross margin %. Leaders to push, laggards to fix,
    and dishes with no selling price (margin can't be known)."""
    recipes = await recipe_service.list_recipes(db, hotel_id)

    def row(r) -> dict:
        return {
            "recipe_id": r.id,
            "name": r.name,
            "selling_price": r.selling_price,
            "cost_per_serving": _q2(r.calculated_cost),
            "margin_pct": r.profit_margin,
        }

    priced = [r for r in recipes if r.selling_price and r.profit_margin is not None]
    no_price = [row(r) for r in recipes if not r.selling_price]
    priced_sorted = sorted(priced, key=lambda r: r.profit_margin, reverse=True)
    margins = [reports_service.parse_pct(r.profit_margin) for r in priced]
    avg_margin = (sum(margins) / len(margins)).quantize(_Q2) if margins else None

    return {
        "avg_margin_pct": avg_margin,
        "priced_count": len(priced),
        "total_count": len(recipes),
        "leaders": [row(r) for r in priced_sorted[:top]],
        "laggards": [row(r) for r in priced_sorted[-top:][::-1]] if priced_sorted else [],
        "no_price": no_price,
    }


async def price_alerts(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    threshold_pct: Decimal = Decimal("5"),
    limit: int = 10,
) -> list[dict]:
    """Items whose latest *paid* unit price (from PO receipts) rose vs the prior
    different price by at least threshold_pct. Cost-creep, from what you actually
    paid — more honest than list-price changes."""
    from app.purchasing.models import POItem, PurchaseOrder
    from app.vendors.models import Vendor

    rows = await db.execute(
        select(
            POItem.item_id,
            Item.name,
            PurchaseOrder.created_at,
            POItem.unit_price,
            Vendor.name,
        )
        .join(PurchaseOrder, PurchaseOrder.id == POItem.po_id)
        .join(Item, Item.id == POItem.item_id)
        .join(Vendor, Vendor.id == PurchaseOrder.vendor_id, isouter=True)
        .where(PurchaseOrder.hotel_id == hotel_id, POItem.unit_price > 0)
        .order_by(POItem.item_id, PurchaseOrder.created_at)
    )
    series: dict[uuid.UUID, list[tuple]] = defaultdict(list)
    for item_id, item_name, created_at, price, vendor_name in rows.all():
        series[item_id].append((created_at, price, item_name, vendor_name))

    alerts: list[dict] = []
    for item_id, points in series.items():
        if len(points) < 2:
            continue
        latest = points[-1]
        prev = next((p for p in reversed(points[:-1]) if p[1] != latest[1]), None)
        if prev is None or latest[1] <= prev[1]:
            continue
        change = ((latest[1] - prev[1]) / prev[1] * 100).quantize(_Q2, ROUND_HALF_UP)
        if change < threshold_pct:
            continue
        alerts.append(
            {
                "item_id": item_id,
                "item_name": latest[2],
                "prev_price": prev[1],
                "latest_price": latest[1],
                "change_pct": change,
                "vendor_name": latest[3],
                "last_ordered": latest[0].date(),
            }
        )
    alerts.sort(key=lambda a: a["change_pct"], reverse=True)
    return alerts[:limit]


async def waste_cost(
    db: AsyncSession, hotel_id: uuid.UUID, date_from: date_type, date_to: date_type
) -> dict:
    """£ value of stock logged as waste in the period (qty × cost at time of waste)."""
    value_expr = func.abs(StockMovement.quantity) * func.coalesce(StockMovement.unit_cost, 0)
    row = await db.execute(
        select(
            func.coalesce(func.sum(value_expr), 0),
            func.count(),
        )
        .join(Item, Item.id == StockMovement.item_id)
        .where(
            Item.hotel_id == hotel_id,
            StockMovement.movement_type == MovementType.WASTE.value,
            StockMovement.created_at >= date_from,
            StockMovement.created_at < date_to + timedelta(days=1),
        )
    )
    total, count = row.one()
    return {"total": _q2(total), "entry_count": count}


async def money_centre(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> dict:
    """One composed payload for the Money page. Defaults to month-to-date."""
    today = date_to or date_type.today()
    start = date_from or today.replace(day=1)

    pnl = await reports_service.pnl(db, hotel_id, start, today)
    stock = await stock_value(db, hotel_id)
    dishes = await dish_margins(db, hotel_id)
    alerts = await price_alerts(db, hotel_id)
    waste = await waste_cost(db, hotel_id, start, today)

    # Break-even: fixed costs ÷ contribution-margin ratio (= gross margin ratio).
    fixed = pnl["operating_expenses"]
    net_sales = pnl["net_sales"]
    contribution_pct = pnl["gross_margin_pct"]  # (net_sales − variable) / net_sales
    break_even_sales = None
    if contribution_pct > 0:
        break_even_sales = (fixed / (contribution_pct / 100)).quantize(_Q2, ROUND_HALF_UP)
    days_elapsed = (today - start).days + 1
    per_day = None
    if break_even_sales is not None and days_elapsed > 0:
        per_day = (break_even_sales / days_elapsed).quantize(_Q2, ROUND_HALF_UP)
    gap = (net_sales - break_even_sales).quantize(_Q2) if break_even_sales is not None else None

    return {
        "date_from": start,
        "date_to": today,
        "net_sales": net_sales,
        "net_profit": pnl["net_profit"],
        "food_cost_pct": pnl["food_cost_pct"],
        "gross_margin_pct": pnl["gross_margin_pct"],
        "net_margin_pct": pnl["net_margin_pct"],
        "stock_value": stock,
        "waste": waste,
        "break_even": {
            "fixed_costs": fixed,
            "contribution_margin_pct": contribution_pct,
            "break_even_sales": break_even_sales,
            "net_sales": net_sales,
            "gap": gap,
            "break_even_per_day": per_day,
            "days_elapsed": days_elapsed,
        },
        "dish_margins": dishes,
        "price_alerts": alerts,
    }
