"""Daily sales & cash endpoints. Hotel-scoped."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import template_io
from app.core.config import settings
from app.core.database import get_db
from app.core.template_io import Column, TemplateSpec
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
    DishCount,
    DishSalesIn,
    DishSalesOut,
    LineCreate,
    RangeSummary,
)

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(prefix="/sales", tags=["sales"])


# ── Channels ────────────────────────────────────────────────────────────────
@router.get("/channels", response_model=list[ChannelOut])
async def list_channels(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:read")),
) -> list[ChannelOut]:
    await service.ensure_default_channels(db, user.hotel_id)  # idempotent
    channels = await service.list_channels(db, user.hotel_id, active_only=False)
    counts = await service.channel_usage_counts(db, user.hotel_id)
    return [
        ChannelOut(
            id=c.id, name=c.name, commission_pct=c.commission_pct, is_active=c.is_active,
            usage_count=counts.get(c.id, 0),
        )
        for c in channels
    ]


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


# ── Strict template import (daily sales) ─────────────────────────────────────
SALES_TEMPLATE = TemplateSpec(
    name="Sales import",
    subtitle="One row per channel for the day. Channel + Gross required (*).",
    columns=[
        Column("channel", "Channel", required=True, aliases=("source", "platform")),
        Column("gross", "Gross", required=True, kind="number",
               aliases=("gross amount", "amount", "sales", "total")),
        Column("method", "Method", aliases=("payment", "payment method", "type")),
    ],
    sample_rows=[
        ["Dine-in", 240.00, "CARD"], ["Deliveroo", 86.50, "CARD"], ["Cash counter", 120.00, "CASH"],
    ],
)


def _sales_file(content: bytes, media_type: str, ext: str) -> Response:
    return Response(
        content=content, media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="mise-sales-template.{ext}"'},
    )


@router.get("/sales-template.xlsx")
async def sales_template(user: User = Depends(require("sales:read"))) -> Response:
    return _sales_file(template_io.template_xlsx(SALES_TEMPLATE), XLSX_MIME, "xlsx")


@router.get("/sales-template.csv")
async def sales_template_csv(user: User = Depends(require("sales:read"))) -> Response:
    return _sales_file(template_io.template_csv(SALES_TEMPLATE), "text/csv", "csv")


@router.post("/days/{day}/import")
async def import_day_sales(
    day: date_type,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:write")),
) -> dict:
    """Upload a day's sales (Excel/CSV). Validated STRICTLY against the template —
    a mismatch returns the exact problems (422). Channels matched by name; unknown skipped."""
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB"
        )
    parsed, errors = template_io.parse_upload(
        data, file.filename or "", file.content_type or "", SALES_TEMPLATE
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})
    rows = [
        (
            r["channel"],
            Decimal(str(r["gross"])) if "gross" in r else None,
            "CASH" if "cash" in str(r.get("method") or "").lower() else "CARD",
        )
        for r in parsed
    ]
    record = await service.upsert_day(db, user.hotel_id, day, entered_by=user.id)
    added = 0
    skipped: list[str] = []
    for name, gross, method in rows:
        if not name or gross is None or gross < 0:
            if name:
                skipped.append(name)
            continue
        ch = await service.get_channel_by_name(db, user.hotel_id, name)
        if ch is None:
            skipped.append(f"{name} (unknown channel)")
            continue
        await service.add_line(db, record, ch.id, gross, method)
        added += 1
    return {"added": added, "skipped": skipped}


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
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="sale.add",
        summary=f"Sale: {channel.name} £{payload.gross_amount} "
                f"({payload.payment_method}) on {day}",
        entity_type="sale",
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


# ── Dish sales (menu-engineering bridge) ──────────────────────────────────────
@router.get("/dishes/{day}", response_model=DishSalesOut)
async def get_dish_sales(
    day: date_type,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:read")),
) -> DishSalesOut:
    counts = await service.list_dish_sales(db, user.hotel_id, day)
    return DishSalesOut(date=day, counts=[DishCount(recipe_id=k, qty=v) for k, v in counts.items()])


@router.post("/dishes/{day}", response_model=DishSalesOut)
async def set_dish_sales(
    day: date_type,
    payload: DishSalesIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("sales:write")),
) -> DishSalesOut:
    await service.upsert_dish_sales(
        db, user.hotel_id, day, {c.recipe_id: c.qty for c in payload.counts}
    )
    counts = await service.list_dish_sales(db, user.hotel_id, day)
    return DishSalesOut(date=day, counts=[DishCount(recipe_id=k, qty=v) for k, v in counts.items()])
