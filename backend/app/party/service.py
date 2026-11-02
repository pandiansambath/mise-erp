"""Party-quote service: confirm (snapshot frozen prices), list history, edit/delete
while active, lock once expired. Hotel-scoped."""
import uuid
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timezones import hotel_today
from app.party.models import PartyQuote, PartyQuoteLine
from app.party.schemas import PartyQuoteCreate

_Q2 = Decimal("0.01")
_DEFAULT_VALID_DAYS = 30


class QuoteExpiredError(Exception):
    """Raised when trying to edit/delete a quote that's already expired (locked)."""


def is_expired(valid_until: date | None, hotel=None) -> bool:
    """A quote expires at the END of its last day, where the restaurant is.
    Server time would expire it early for anywhere east of UTC."""
    today = hotel_today(hotel) if hotel is not None else date.today()
    return valid_until is not None and valid_until < today


def _money(v: float | None) -> Decimal | None:
    """A price as it will be STORED — 2dp, half-up like Postgres — so the totals
    are the sum of the very figures the lines show."""
    return None if v is None else Decimal(str(v)).quantize(_Q2, rounding=ROUND_HALF_UP)


def _per_plate_cost(v: float | None) -> Decimal:
    """A plate's COST at the recipe's own precision (4dp), not money's 2dp.

    The total is plates x this. Rounding it to the penny first made a 500-plate
    line drift by up to £2.50 from what the owner saw on Confirm (0.125 stored
    as 0.13 x 500 = 65.00, not 62.50). The column keeps 2dp for display; the
    TOTAL is worked out before it is stored, from this figure."""
    return Decimal(str(v or 0)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def own_price(ln: PartyQuoteLine) -> bool:
    """The owner set this line's price himself. Derived from the two prices,
    never stored — a flag beside them could disagree with them."""
    return ln.unit_price is not None and ln.unit_price != ln.recipe_price


def _totals(lines: list[PartyQuoteLine]) -> tuple[Decimal, Decimal]:
    # Summed over the BUILT lines, not the request: a total that rounds the raw
    # floats can sit a penny away from the lines it is the total of (12.345 x 3
    # stored each plate at 12.35 = 37.05, but totalled 37.04).
    total_price = Decimal("0")
    total_cost = Decimal("0")
    for ln in lines:
        qd = Decimal(str(ln.qty or 0))
        total_cost += Decimal(str(ln.unit_cost or 0)) * qd
        if ln.unit_price is not None:
            total_price += Decimal(str(ln.unit_price)) * qd
    return total_price.quantize(_Q2), total_cost.quantize(_Q2)


def _valid_until(event_date: date | None, hotel=None) -> date:
    base = hotel_today(hotel) if hotel is not None else date.today()
    return event_date or (base + timedelta(days=_DEFAULT_VALID_DAYS))


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
                "recipe_price": float(ln.recipe_price) if ln.recipe_price is not None else None,
                "own_price": own_price(ln),
                "unit_cost": float(ln.unit_cost),
            }
            for ln in q.lines
        ],
    }


def _line_models(data: PartyQuoteCreate) -> list[PartyQuoteLine]:
    """The lines as they will be stored. The quote they hang off sets quote_id."""
    out = []
    for ln in data.lines:
        unit_price = _money(ln.unit_price)
        # A page from before own prices sends no recipe_price at all — and every
        # price it could send WAS the recipe's, so the line is recipe-priced. Only
        # an explicit null means "the recipe has no price". Without this a stale
        # browser bundle mid-deploy would mark every line it saves as an own price.
        if "recipe_price" in ln.model_fields_set:
            recipe_price = _money(ln.recipe_price)
        else:
            recipe_price = unit_price
        out.append(
            PartyQuoteLine(
                recipe_id=ln.recipe_id,
                name=ln.name,
                qty=ln.qty,
                unit_price=unit_price,
                recipe_price=recipe_price,
                unit_cost=_per_plate_cost(ln.unit_cost),
            )
        )
    return out


async def create_quote(
    db: AsyncSession, hotel_id: uuid.UUID, created_by: uuid.UUID, data: PartyQuoteCreate
) -> PartyQuote:
    lines = _line_models(data)
    total_price, total_cost = _totals(lines)
    q = PartyQuote(
        hotel_id=hotel_id,
        customer=(data.customer or None),
        event_date=data.event_date,
        valid_until=_valid_until(data.event_date),
        currency=data.currency or "GBP ",
        total_price=total_price,
        total_cost=total_cost,
        created_by=created_by,
        lines=lines,
    )
    db.add(q)
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
    lines = _line_models(data)
    q.customer = data.customer or None
    q.event_date = data.event_date
    q.valid_until = _valid_until(data.event_date)
    q.currency = data.currency or "GBP "
    q.total_price, q.total_cost = _totals(lines)
    # Replacing the collection lets delete-orphan remove the old rows. Deleting
    # them one by one left them IN the loaded collection (expire_on_commit=False),
    # so the response echoed the old lines beside the new. get_quote's selectinload
    # already loaded q.lines, so this assignment does no lazy I/O.
    q.lines = lines
    await db.commit()
    return await get_quote(db, q.id, q.hotel_id)


async def delete_quote(db: AsyncSession, q: PartyQuote) -> None:
    if is_expired(q.valid_until):
        raise QuoteExpiredError("This quote has expired and can no longer be removed.")
    await db.delete(q)
    await db.commit()
