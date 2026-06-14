"""Budget vs actual: per-hotel monthly targets + this-month actuals."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.reports import service as reports_service
from app.reports.models import BudgetTarget
from app.rota import service as rota_service

_FIELDS = ("monthly_sales", "food_cost_pct", "labour_pct", "net_margin_pct")


async def get_targets(db: AsyncSession, hotel_id: uuid.UUID) -> BudgetTarget | None:
    return (
        await db.execute(select(BudgetTarget).where(BudgetTarget.hotel_id == hotel_id))
    ).scalar_one_or_none()


async def set_targets(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> BudgetTarget:
    row = await get_targets(db, hotel_id)
    if row is None:
        row = BudgetTarget(hotel_id=hotel_id)
        db.add(row)
    for k in _FIELDS:
        if k in fields:
            setattr(row, k, fields[k])
    await db.commit()
    await db.refresh(row)
    return row


async def budget_vs_actual(db: AsyncSession, hotel_id: uuid.UUID) -> dict:
    today = date_type.today()
    start = today.replace(day=1)
    pnl = await reports_service.pnl(db, hotel_id, start, today)
    labour = await rota_service.labour_summary(db, hotel_id, start, today)
    targets = await get_targets(db, hotel_id)

    def t(attr: str) -> Decimal | None:
        return getattr(targets, attr) if targets else None

    return {
        "month_start": start,
        "today": today,
        "targets": {f: t(f) for f in _FIELDS},
        "actual": {
            "monthly_sales": pnl["net_sales"],
            "food_cost_pct": pnl["food_cost_pct"],
            "labour_pct": labour["labour_pct"],
            "net_margin_pct": pnl["net_margin_pct"],
        },
    }
