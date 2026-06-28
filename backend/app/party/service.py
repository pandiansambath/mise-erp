"""Party-quote service: confirm (snapshot frozen prices), list history, edit/delete
while active, lock once expired. Hotel-scoped."""
import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.party.models import PartyQuote, PartyQuoteLine
from app.party.schemas import PartyQuoteCreate

_Q2 = Decimal("0.01")
_DEFAULT_VALID_DAYS = 30


class QuoteExpiredError(Exception):
    """Raised when trying to edit/delete a quote that's already expired (locked)."""


def is_expired(valid_until: date | None) -> bool:
    return valid_until is not None and valid_until < date.today()


def _totals(lines) -> tuple[Decimal, Decimal]:
    total_price = Decimal("0")
    total_cost = Decimal("0")
    for ln in lines:
        qd = Decimal(str(ln.qty or 0))
        total_cost += Decimal(str(ln.unit_cost or 0)) * qd
        if ln.unit_price is not None:
            total_price += Decimal(str(ln.unit_price)) * qd
    return total_price.quantize(_Q2), total_cost.quantize(_Q2)


def _valid_until(event_date: date | None) -> date:
    return event_date or (date.today() + timedelta(days=_DEFAULT_VALID_DAYS))


def quote_dict(q: PartyQuote) -> dict:
    tp = q.total_price
    profit = tp - q.total_cost
    margin = (profit / tp * 100).quantize(_Q2) if tp > 0 else Decimal("0.00")
    return {
        "id": q.id,
        "customer": q.customer,
        "event_date": q.event_date,
        "valid_until": q.valid_until,
        "currency": q.currency,
        "total_price": float(tp),
        "total_cost": float(q.total_cost),
        "profit": float(profit),
        "margin": float(margin),
        "is_expired": is_expired(q.valid_until),
        "created_at": q.created_at,
        "lines": [
            {
                "recipe_id": ln.recipe_id,
                "name": ln.name,
                "qty": ln.qty,
                "unit_price": float(ln.unit_price) if ln.unit_price is not None else None,
                "unit_cost": float(ln.unit_cost),
            }
            for ln in q.lines
        ],
    }


def _line_models(quote_id: uuid.UUID, data: PartyQuoteCreate) -> list[PartyQuoteLine]:
    return [
        PartyQuoteLine(
            quote_id=quote_id,
            recipe_id=ln.recipe_id,
            name=ln.name,
            qty=ln.qty,
            unit_price=Decimal(str(ln.unit_price)) if ln.unit_price is not None else None,
            unit_cost=Decimal(str(ln.unit_cost)),
        )
        for ln in data.lines
    ]


async def create_quote(
    db: AsyncSession, hotel_id: uuid.UUID, created_by: uuid.UUID, data: PartyQuoteCreate
) -> PartyQuote:
    total_price, total_cost = _totals(data.lines)
    q = PartyQuote(
        hotel_id=hotel_id,
        customer=(data.customer or None),
        event_date=data.event_date,
        valid_until=_valid_until(data.event_date),
        currency=data.currency or "GBP ",
        total_price=total_price,
        total_cost=total_cost,
        created_by=created_by,
    )
    db.add(q)
    await db.flush()
    for ln in _line_models(q.id, data):
        db.add(ln)
    await db.commit()
    return await get_quote(db, q.id, hotel_id)


async def list_quotes(db: AsyncSession, hotel_id: uuid.UUID) -> list[PartyQuote]:
    rows = await db.execute(
        select(PartyQuote)
        .options(selectinload(PartyQuote.lines))
        .where(PartyQuote.hotel_id == hotel_id)
        .order_by(PartyQuote.created_at.desc())
    )
    return list(rows.scalars())


async def get_quote(
    db: AsyncSession, quote_id: uuid.UUID, hotel_id: uuid.UUID
) -> PartyQuote | None:
    # A select() with selectinload eagerly loads `lines` — db.get() would return the
    # identity-map row without it and trip MissingGreenlet on async lazy access.
    rows = await db.execute(
        select(PartyQuote)
        .options(selectinload(PartyQuote.lines))
        .where(PartyQuote.id == quote_id, PartyQuote.hotel_id == hotel_id)
    )
    return rows.scalar_one_or_none()


async def update_quote(
    db: AsyncSession, q: PartyQuote, data: PartyQuoteCreate
) -> PartyQuote:
    if is_expired(q.valid_until):
        raise QuoteExpiredError("This quote has expired and can no longer be edited.")
    for ln in list(q.lines):
        await db.delete(ln)
    await db.flush()
    total_price, total_cost = _totals(data.lines)
    q.customer = data.customer or None
    q.event_date = data.event_date
    q.valid_until = _valid_until(data.event_date)
    q.currency = data.currency or "GBP "
    q.total_price = total_price
    q.total_cost = total_cost
    for ln in _line_models(q.id, data):
        db.add(ln)
    await db.commit()
    return await get_quote(db, q.id, q.hotel_id)


async def delete_quote(db: AsyncSession, q: PartyQuote) -> None:
    if is_expired(q.valid_until):
        raise QuoteExpiredError("This quote has expired and can no longer be removed.")
    await db.delete(q)
    await db.commit()
