"""Daily sales & cash service: channels, daily entry, commission/net, cash variance."""
import uuid
from datetime import date as date_type
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.sales.models import DailySales, DishSale, PaymentMethod, SalesChannel, SalesLine

_Q2 = Decimal("0.01")

# Default channels seeded per hotel (UK delivery-app commissions).
DEFAULT_CHANNELS = [
    ("Dine-In", "0"),
    ("Takeaway", "0"),
    ("Deliveroo", "30"),
    ("Uber Eats", "30"),
    ("Just Eat", "14"),
    ("FoodHub", "5"),
]


def commission_for(gross: Decimal, pct: Decimal) -> Decimal:
    return (gross * pct / Decimal("100")).quantize(_Q2, ROUND_HALF_UP)


# ── Channels ────────────────────────────────────────────────────────────────
async def list_channels(
    db: AsyncSession, hotel_id: uuid.UUID, *, active_only: bool = True
) -> list[SalesChannel]:
    stmt = select(SalesChannel).where(SalesChannel.hotel_id == hotel_id)
    if active_only:
        stmt = stmt.where(SalesChannel.is_active.is_(True))
    result = await db.execute(stmt.order_by(SalesChannel.name))
    return list(result.scalars().all())


async def channel_usage_counts(db: AsyncSession, hotel_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """channel_id -> number of sales lines using it (drives the safe-archive warning)."""
    rows = await db.execute(
        select(SalesLine.channel_id, func.count())
        .join(DailySales, SalesLine.daily_sales_id == DailySales.id)
        .where(DailySales.hotel_id == hotel_id)
        .group_by(SalesLine.channel_id)
    )
    return {cid: n for cid, n in rows.all()}


async def get_channel(
    db: AsyncSession, channel_id: uuid.UUID, hotel_id: uuid.UUID
) -> SalesChannel | None:
    ch = await db.get(SalesChannel, channel_id)
    if ch is None or ch.hotel_id != hotel_id:
        return None
    return ch


async def get_channel_by_name(
    db: AsyncSession, hotel_id: uuid.UUID, name: str
) -> SalesChannel | None:
    """Case-insensitive channel lookup (used by the sales Excel import)."""
    stmt = select(SalesChannel).where(
        SalesChannel.hotel_id == hotel_id, func.lower(SalesChannel.name) == name.strip().lower()
    ).limit(1)
    return (await db.execute(stmt)).scalars().first()


async def create_channel(
    db: AsyncSession, hotel_id: uuid.UUID, name: str, commission_pct: Decimal
) -> SalesChannel:
    ch = SalesChannel(hotel_id=hotel_id, name=name, commission_pct=commission_pct)
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    return ch


async def update_channel(db: AsyncSession, ch: SalesChannel, **fields) -> SalesChannel:
    for k, v in fields.items():
        if v is not None:
            setattr(ch, k, v)
    await db.commit()
    await db.refresh(ch)
    return ch


async def ensure_default_channels(db: AsyncSession, hotel_id: uuid.UUID) -> None:
    existing = await list_channels(db, hotel_id, active_only=False)
    if existing:
        return
    for name, pct in DEFAULT_CHANNELS:
        db.add(SalesChannel(hotel_id=hotel_id, name=name, commission_pct=Decimal(pct)))
    await db.commit()


# ── Daily entry ───────────────────────────────────────────────────────────────
async def _get_day(db: AsyncSession, hotel_id: uuid.UUID, day: date_type) -> DailySales | None:
    result = await db.execute(
        select(DailySales).where(DailySales.hotel_id == hotel_id, DailySales.date == day)
    )
    return result.scalar_one_or_none()


async def upsert_day(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    day: date_type,
    *,
    opening_cash: Decimal | None = None,
    cash_counted: Decimal | None = None,
    notes: str | None = None,
    entered_by: uuid.UUID | None = None,
) -> DailySales:
    record = await _get_day(db, hotel_id, day)
    if record is None:
        record = DailySales(hotel_id=hotel_id, date=day, entered_by=entered_by)
        db.add(record)
    if opening_cash is not None:
        record.opening_cash = opening_cash
    if cash_counted is not None:
        record.cash_counted = cash_counted
    if notes is not None:
        record.notes = notes
    await db.commit()
    await db.refresh(record)
    return record


async def add_line(
    db: AsyncSession,
    day: DailySales,
    channel_id: uuid.UUID,
    gross_amount: Decimal,
    payment_method: str,
    notes: str | None = None,
) -> SalesLine:
    line = SalesLine(
        daily_sales_id=day.id,
        channel_id=channel_id,
        gross_amount=gross_amount,
        payment_method=payment_method,
        notes=notes,
    )
    db.add(line)
    await db.commit()
    await db.refresh(line)
    return line


async def delete_line(db: AsyncSession, line: SalesLine) -> None:
    await db.delete(line)
    await db.commit()


async def get_line(db: AsyncSession, line_id: uuid.UUID) -> SalesLine | None:
    return await db.get(SalesLine, line_id)


async def day_summary(db: AsyncSession, hotel_id: uuid.UUID, day: date_type) -> dict:
    """Build a full day view with per-line commission/net, totals, and cash variance.
    Works even if the day hasn't been created yet (returns an empty shell)."""
    record = await _get_day(db, hotel_id, day)

    lines_out: list[dict] = []
    gross = commission = net = cash_sales = card_sales = Decimal("0")

    if record is not None:
        rows = await db.execute(
            select(SalesLine, SalesChannel)
            .join(SalesChannel, SalesLine.channel_id == SalesChannel.id)
            .where(SalesLine.daily_sales_id == record.id)
            .order_by(SalesChannel.name)
        )
        for line, channel in rows.all():
            comm = commission_for(line.gross_amount, channel.commission_pct)
            line_net = (line.gross_amount - comm).quantize(_Q2, ROUND_HALF_UP)
            gross += line.gross_amount
            commission += comm
            net += line_net
            if line.payment_method == PaymentMethod.CASH.value:
                cash_sales += line.gross_amount
            elif line.payment_method == PaymentMethod.CARD.value:
                card_sales += line.gross_amount
            lines_out.append(
                {
                    "id": line.id,
                    "channel_id": channel.id,
                    "channel_name": channel.name,
                    "gross_amount": line.gross_amount,
                    "commission": comm,
                    "net_amount": line_net,
                    "payment_method": line.payment_method,
                }
            )

    opening = record.opening_cash if record else Decimal("0")
    counted = record.cash_counted if record else None
    expected_cash = opening + cash_sales
    variance = (counted - expected_cash) if counted is not None else None

    return {
        "id": record.id if record else None,
        "date": day,
        "opening_cash": opening,
        "cash_counted": counted,
        "expected_cash": expected_cash,
        "cash_variance": variance,
        "notes": record.notes if record else None,
        "lines": lines_out,
        "totals": {
            "gross": gross,
            "commission": commission,
            "net": net,
            "cash_sales": cash_sales,
            "card_sales": card_sales,
        },
    }


async def daily_net(
    db: AsyncSession, hotel_id: uuid.UUID, date_from: date_type, date_to: date_type
) -> list[dict]:
    """Net sales per day in one query — feeds trend charts and heatmaps."""
    rows = await db.execute(
        select(DailySales.date, SalesLine.gross_amount, SalesChannel.commission_pct)
        .select_from(SalesLine)
        .join(SalesChannel, SalesLine.channel_id == SalesChannel.id)
        .join(DailySales, SalesLine.daily_sales_id == DailySales.id)
        .where(
            DailySales.hotel_id == hotel_id,
            DailySales.date >= date_from,
            DailySales.date <= date_to,
        )
    )
    by_day: dict[date_type, Decimal] = {}
    for d, gross, pct in rows.all():
        net = gross - commission_for(gross, pct)
        by_day[d] = by_day.get(d, Decimal("0")) + net
    return [
        {"date": d.isoformat(), "net": str(v.quantize(_Q2))} for d, v in sorted(by_day.items())
    ]


async def range_summary(
    db: AsyncSession, hotel_id: uuid.UUID, date_from: date_type, date_to: date_type
) -> dict:
    """Aggregate gross/commission/net across a date range (for dashboard/P&L)."""
    rows = await db.execute(
        select(SalesLine, SalesChannel)
        .join(SalesChannel, SalesLine.channel_id == SalesChannel.id)
        .join(DailySales, SalesLine.daily_sales_id == DailySales.id)
        .where(
            DailySales.hotel_id == hotel_id,
            DailySales.date >= date_from,
            DailySales.date <= date_to,
        )
    )
    gross = commission = net = Decimal("0")
    days: set = set()
    for line, channel in rows.all():
        comm = commission_for(line.gross_amount, channel.commission_pct)
        gross += line.gross_amount
        commission += comm
        net += line.gross_amount - comm
    day_rows = await db.execute(
        select(DailySales.date).where(
            DailySales.hotel_id == hotel_id,
            DailySales.date >= date_from,
            DailySales.date <= date_to,
        )
    )
    days = {d for (d,) in day_rows.all()}
    return {
        "date_from": date_from,
        "date_to": date_to,
        "gross": gross.quantize(_Q2),
        "commission": commission.quantize(_Q2),
        "net": net.quantize(_Q2),
        "days": len(days),
    }


# ── Dish sales (menu-engineering bridge) ──────────────────────────────────────
async def list_dish_sales(
    db: AsyncSession, hotel_id: uuid.UUID, day: date_type
) -> dict[uuid.UUID, int]:
    rows = await db.execute(
        select(DishSale.recipe_id, DishSale.qty_sold).where(
            DishSale.hotel_id == hotel_id, DishSale.date == day
        )
    )
    return {rid: int(qty) for rid, qty in rows.all()}


async def upsert_dish_sales(
    db: AsyncSession, hotel_id: uuid.UUID, day: date_type, counts: dict[uuid.UUID, int]
) -> int:
    """Set qty_sold per recipe for a date (upsert). Zero clears nothing extra — it
    just records 0. Returns the number of recipes touched."""
    existing = await db.execute(
        select(DishSale).where(DishSale.hotel_id == hotel_id, DishSale.date == day)
    )
    by_recipe = {ds.recipe_id: ds for ds in existing.scalars().all()}
    for recipe_id, qty in counts.items():
        q = max(0, int(qty or 0))
        ds = by_recipe.get(recipe_id)
        if ds is not None:
            ds.qty_sold = q
        elif q > 0:
            db.add(DishSale(hotel_id=hotel_id, recipe_id=recipe_id, date=day, qty_sold=q))
    await db.commit()
    return len(counts)
