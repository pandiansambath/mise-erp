"""Daily sales & cash endpoints. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.hotels.models import Hotel
from app.sales import pdf as sales_pdf
from app.sales import service
from app.sales.schemas import (
    ChannelCreate,
    ChannelOut,
    ChannelUpdate,
    DayCreatedOut,
    DaySummary,
    DayUpsert,
    LineCreate,
    RangeSummary,
)

router = APIRouter(prefix="/sales", tags=["sales"])


# ── Channels ────────────────────────────────────────────────────────────────
@router.get("/channels", response_model=list[ChannelOut])
async def list_channels(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:read")),
) -> list[ChannelOut]:
    await service.ensure_default_channels(db, user.hotel_id)  # idempotent
    channels = await service.list_channels(db, user.hotel_id, active_only=False)
    return [ChannelOut.model_validate(c) for c in channels]


@router.post("/channels", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(
    payload: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:config")),
) -> ChannelOut:
    ch = await service.create_channel(db, user.hotel_id, payload.name, payload.commission_pct)
    return ChannelOut.model_validate(ch)


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(
    channel_id: uuid.UUID,
    payload: ChannelUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:config")),
) -> ChannelOut:
    ch = await service.get_channel(db, channel_id, user.hotel_id)
    if ch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")
    ch = await service.update_channel(db, ch, **payload.model_dump(exclude_unset=True))
    return ChannelOut.model_validate(ch)


# ── Daily entry ───────────────────────────────────────────────────────────────
@router.get("/days/{day}", response_model=DaySummary)
async def get_day(
    day: date_type,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:read")),
) -> DaySummary:
    return DaySummary.model_validate(await service.day_summary(db, user.hotel_id, day))


@router.get("/days/{day}/sheet.pdf")
async def day_sheet_pdf(
    day: date_type,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:read")),
) -> Response:
    summary = await service.day_summary(db, user.hotel_id, day)
    hotel = await db.get(Hotel, user.hotel_id)
    pdf = sales_pdf.generate_day_pdf(summary, hotel)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="sales-{day}.pdf"'},
    )


@router.patch("/days/{day}", response_model=DayCreatedOut)
async def upsert_day(
    day: date_type,
    payload: DayUpsert,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:write")),
) -> DayCreatedOut:
    record = await service.upsert_day(
        db,
        user.hotel_id,
        day,
        opening_cash=payload.opening_cash,
        cash_counted=payload.cash_counted,
        notes=payload.notes,
        entered_by=user.id,
    )
    return DayCreatedOut.model_validate(record)


@router.post("/days/{day}/lines", response_model=DaySummary, status_code=status.HTTP_201_CREATED)
async def add_line(
    day: date_type,
    payload: LineCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:write")),
) -> DaySummary:
    channel = await service.get_channel(db, payload.channel_id, user.hotel_id)
    if channel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")
    record = await service.upsert_day(db, user.hotel_id, day, entered_by=user.id)
    await service.add_line(
        db, record, payload.channel_id, payload.gross_amount, payload.payment_method, payload.notes
    )
    return DaySummary.model_validate(await service.day_summary(db, user.hotel_id, day))


@router.delete("/days/{day}/lines/{line_id}", response_model=DaySummary)
async def delete_line(
    day: date_type,
    line_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:write")),
) -> DaySummary:
    line = await service.get_line(db, line_id)
    record = await service._get_day(db, user.hotel_id, day)
    if line is None or record is None or line.daily_sales_id != record.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Line not found")
    await service.delete_line(db, line)
    return DaySummary.model_validate(await service.day_summary(db, user.hotel_id, day))


@router.get("/summary", response_model=RangeSummary)
async def summary(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:read")),
) -> RangeSummary:
    return RangeSummary.model_validate(
        await service.range_summary(db, user.hotel_id, date_from, date_to)
    )
