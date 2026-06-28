"""Party-order quote endpoints: confirm/save, history, edit/delete (while active),
download a saved quote as a branded PDF. Hotel-scoped."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.hotels.models import Hotel
from app.party import service
from app.party.schemas import PartyQuoteCreate, PartyQuoteOut
from app.recipes import pdf as recipe_pdf

router = APIRouter(prefix="/party-quotes", tags=["party"])


@router.post("", response_model=PartyQuoteOut, status_code=status.HTTP_201_CREATED)
async def create_quote(
    payload: PartyQuoteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> PartyQuoteOut:
    q = await service.create_quote(db, user.hotel_id, user.id, payload)
    return PartyQuoteOut.model_validate(service.quote_dict(q))


@router.get("", response_model=list[PartyQuoteOut])
async def list_quotes(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> list[PartyQuoteOut]:
    quotes = await service.list_quotes(db, user.hotel_id)
    return [PartyQuoteOut.model_validate(service.quote_dict(q)) for q in quotes]


# Defined before /{quote_id} so the ".pdf" suffix isn't captured as a quote id.
@router.get("/{quote_id}.pdf")
async def quote_pdf(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> Response:
    """Download a saved quote (frozen prices) as a branded PDF."""
    q = await service.get_quote(db, quote_id, user.hotel_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    hotel = await db.get(Hotel, user.hotel_id)
    data = recipe_pdf.party_quote_pdf(
        hotel.name if hotel else "Mise",
        q.customer or "",
        str(q.event_date) if q.event_date else "",
        q.currency,
        [
            {
                "name": ln.name,
                "qty": ln.qty,
                "unit_price": float(ln.unit_price) if ln.unit_price is not None else None,
                "unit_cost": float(ln.unit_cost),
            }
            for ln in q.lines
        ],
    )
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="party-order-quote.pdf"'},
    )


@router.get("/{quote_id}", response_model=PartyQuoteOut)
async def get_quote(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> PartyQuoteOut:
    q = await service.get_quote(db, quote_id, user.hotel_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    return PartyQuoteOut.model_validate(service.quote_dict(q))


@router.patch("/{quote_id}", response_model=PartyQuoteOut)
async def update_quote(
    quote_id: uuid.UUID,
    payload: PartyQuoteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> PartyQuoteOut:
    q = await service.get_quote(db, quote_id, user.hotel_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    try:
        q = await service.update_quote(db, q, payload)
    except service.QuoteExpiredError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return PartyQuoteOut.model_validate(service.quote_dict(q))


@router.delete("/{quote_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quote(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> None:
    q = await service.get_quote(db, quote_id, user.hotel_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    try:
        await service.delete_quote(db, q)
    except service.QuoteExpiredError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
