"""Vendor endpoints: CRUD, item pricing, and price comparison. Hotel-scoped."""
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require, require_feature
from app.auth.models import User
from app.core import template_io
from app.core.config import settings
from app.core.database import get_db
from app.core.template_io import XLSX_MIME, Column, TemplateSpec
from app.inventory import matching, pack_service, packs
from app.inventory.models import Item
from app.inventory.service import get_item
from app.purchasing import service as purchasing_service
from app.purchasing import volume
from app.vendors import ledger, service
from app.vendors.models import VendorPayment
from app.vendors.schemas import (
    PriceComparison,
    VendorCreate,
    VendorItemOut,
    VendorItemUpsert,
    VendorOut,
    VendorPaymentCreate,
    VendorUpdate,
)


class PreferredIn(BaseModel):
    vendor_id: uuid.UUID | None = None

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.post("", response_model=VendorOut, status_code=status.HTTP_201_CREATED)
async def create_vendor(
    payload: VendorCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> VendorOut:
    try:
        vendor = await service.create_vendor(
            db, user.hotel_id, **payload.model_dump(exclude_none=True)
        )
    except service.DuplicateVendorError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return VendorOut.model_validate(vendor)


@router.get("/spend")
async def vendor_spend(
    days: int = Query(default=90, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> dict:
    """What you've actually paid each vendor (received POs) in the window."""
    return {"days": days, "vendors": await service.spend_by_vendor(db, user.hotel_id, days)}


@router.get("", response_model=list[VendorOut])
async def list_vendors(
    category: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> list[VendorOut]:
    vendors = await service.list_vendors(db, user.hotel_id, category=category)
    return [VendorOut.model_validate(v) for v in vendors]


# Strict price-list template (Item + Price required; Unit optional).
PRICE_LIST_TEMPLATE = TemplateSpec(
    name="Vendor price list",
    subtitle="One row per item this supplier sells. Item + Price are required (*).",
    columns=[
        Column("item", "Item", required=True, aliases=("item name", "name", "product")),
        Column("price", "Price", required=True, kind="number",
               aliases=("price per unit", "unit price", "rate", "cost")),
        Column("unit", "Unit", aliases=("uom",)),
    ],
    sample_rows=[
        ["Basmati Rice", 5.00, "kg"], ["Ghee", 6.80, "kg"], ["Carry Bags (Large)", 3.55, "pack"],
    ],
)


def _pl_file(content: bytes, media_type: str, ext: str) -> Response:
    return Response(
        content=content, media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="mise-vendor-price-list.{ext}"'},
    )


@router.get("/{vendor_id}/price-list.xlsx")
async def vendor_price_list(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> Response:
    """Everything this supplier sells us, with prices, as a spreadsheet.

    "for each vendor I need one download feature — I can download vendor items
     or items with price details."

    He tried to get this through the voice first and was told it could not be
    seen, which was true: there was no way to get it out of the app at all.
    """
    from openpyxl import Workbook

    from app.core.template_io import style_table

    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")

    rows = await service.vendor_price_rows(db, vendor_id, user.hotel_id)

    wb = Workbook()
    ws = wb.active
    ws.title = "Price list"
    headers = ["Item", "Category", "Unit", "Price", "Chosen", "Last updated", "Notes"]
    for i, r in enumerate(rows):
        for c, val in enumerate(
            [
                r["item"],
                r["category"],
                r["unit"],
                float(r["price"] or 0),
                "yes" if r["preferred"] else "",
                r["updated"],
                r["notes"] or "",
            ],
            start=1,
        ):
            ws.cell(row=4 + i, column=c, value=val)
    style_table(
        ws,
        title=f"{vendor.name} — price list",
        subtitle=f"{len(rows)} items - exported from DineAI",
        headers=headers,
        n_rows=max(len(rows), 1),
        widths=[34, 18, 10, 12, 10, 14, 30],
        right_cols={4},
    )
    from io import BytesIO

    buf = BytesIO()
    wb.save(buf)
    safe = "".join(ch for ch in vendor.name if ch.isalnum() or ch in " -_").strip() or "vendor"
    return Response(
        content=buf.getvalue(),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{safe} price list.xlsx"'},
    )


@router.get("/price-list-template.xlsx")
async def price_list_template(user: User = Depends(require("vendors:read"))) -> Response:
    return _pl_file(template_io.template_xlsx(PRICE_LIST_TEMPLATE), XLSX_MIME, "xlsx")


@router.get("/price-list-template.csv")
async def price_list_template_csv(user: User = Depends(require("vendors:read"))) -> Response:
    return _pl_file(template_io.template_csv(PRICE_LIST_TEMPLATE), "text/csv", "csv")


@router.get(
    "/items/{item_id}/price-comparison",
    response_model=PriceComparison,
    dependencies=[Depends(require_feature("price_comparison"))],
)
async def price_comparison(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> PriceComparison:
    """For one item: every vendor's price, cheapest first, and how much you'd save."""
    result = await service.compare_vendor_prices(db, item_id, user.hotel_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return PriceComparison.model_validate(result)


@router.get("/items/{item_id}/price-history")
async def item_price_history(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> dict:
    """The full price timeline for an item across its vendors (newest first)."""
    return {"history": await service.item_price_history(db, user.hotel_id, item_id)}


@router.post("/items/{item_id}/preferred", response_model=PriceComparison)
async def set_preferred(
    item_id: uuid.UUID,
    payload: PreferredIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> PriceComparison:
    """Mark a vendor as preferred for this item (recipe costing uses preferred, else cheapest)."""
    ok = await service.set_preferred_vendor(db, user.hotel_id, item_id, payload.vendor_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor does not supply this item")
    result = await service.compare_vendor_prices(db, item_id, user.hotel_id)
    vendor = await service.get_vendor(db, payload.vendor_id, user.hotel_id)
    item = await get_item(db, item_id, user.hotel_id)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="vendor.chosen",
        summary=f"Chose {vendor.name if vendor else 'a supplier'} as supplier for "
        f"{item.name if item else 'an item'}",
        entity_type="item", entity_id=item_id,
    )
    return PriceComparison.model_validate(result)


@router.get("/{vendor_id}", response_model=VendorOut)
async def get_vendor(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> VendorOut:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return VendorOut.model_validate(vendor)


@router.patch("/{vendor_id}", response_model=VendorOut)
async def update_vendor(
    vendor_id: uuid.UUID,
    payload: VendorUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> VendorOut:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    vendor = await service.update_vendor(db, vendor, **payload.model_dump(exclude_unset=True))
    return VendorOut.model_validate(vendor)


@router.post(
    "/{vendor_id}/items", response_model=VendorItemOut, status_code=status.HTTP_201_CREATED
)
async def upsert_vendor_item(
    vendor_id: uuid.UUID,
    payload: VendorItemUpsert,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> VendorItemOut:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    item = await get_item(db, payload.item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    # The supplier may simply NAME the pack they sell in — "1 bottle holds 20
    # kg" — instead of picking a rung somebody had to create in Inventory
    # first. An unfamiliar name joins the item's chain; a familiar one is
    # reused, and the size they quoted lands on their own row, which is what
    # makes two suppliers able to disagree about how big a bottle is.
    level_id = (
        payload.pack_level_id if "pack_level_id" in payload.model_fields_set else service.KEEP
    )
    size_override = (
        payload.pack_size_override
        if "pack_size_override" in payload.model_fields_set
        else service.KEEP
    )
    if payload.pack_name and payload.pack_size and payload.pack_size > 0:
        level = await pack_service.ensure_level(db, item, payload.pack_name, payload.pack_size)
        if level is not None:
            level_id = level.id
            size_override = payload.pack_size
    elif payload.pack_name is not None and not payload.pack_name.strip():
        # Cleared back to "sold loose" — they quote the base unit again.
        level_id = None
        size_override = None

    vi = await service.upsert_vendor_item(
        db,
        vendor_id,
        payload.item_id,
        payload.price_per_unit,
        is_preferred=payload.is_preferred,
        notes=payload.notes,
        pack_level_id=level_id,
        # Only forward it when the client actually sent the field, so the
        # "change the price" form does not clear the supplier's pack size.
        pack_size_override=size_override,
    )
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="vendor.price",
        summary=f"Set {vendor.name} price for {item.name} → {payload.price_per_unit}",
        entity_type="item", entity_id=item.id,
    )
    return VendorItemOut.model_validate(vi)


@router.post("/{vendor_id}/items/import")
async def import_price_list(
    vendor_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> dict:
    """Upload a vendor's price list (Excel/CSV). Validated STRICTLY against the
    template — a mismatch returns the exact problems (422) so the user can fix it.
    Matches items by name (creates new ones), upserts each price."""
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB"
        )
    rows, errors = template_io.parse_upload(
        data, file.filename or "", file.content_type or "", PRICE_LIST_TEMPLATE
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})
    tuples = [
        (r["item"], Decimal(str(r["price"])) if "price" in r else None, r.get("unit"))
        for r in rows
    ]
    return await service.import_price_list(db, user.hotel_id, vendor_id, tuples)


@router.get("/{vendor_id}/items", response_model=list[VendorItemOut])
async def list_vendor_items(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> list[VendorItemOut]:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    items = await service.list_vendor_items(db, vendor_id)
    return [VendorItemOut.model_validate(i) for i in items]


@router.delete("/{vendor_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_vendor_item(
    vendor_id: uuid.UUID,
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> Response:
    """Remove this vendor's price for an item (the item itself stays)."""
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    ok = await service.delete_vendor_item(db, vendor_id, item_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This vendor has no price for that item")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── What you owe a supplier ─────────────────────────────────────────────────
# Deliveries arrive daily, money leaves weekly. Between the two is a balance
# nothing in the app could state until now.


@router.get("/{vendor_id}/balance")
async def vendor_balance(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> dict:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return await ledger.balance(db, user.hotel_id, vendor_id)


@router.get("/{vendor_id}/statement")
async def vendor_statement(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> dict:
    """Deliveries and payments interleaved, with a running balance.

    Returned alongside the totals so a supplier's invoice can be checked line by
    line — a bare "you owe £1,240" is unarguable and therefore useless in a
    disagreement.
    """
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return {
        **(await ledger.balance(db, user.hotel_id, vendor_id)),
        "entries": await ledger.statement(db, user.hotel_id, vendor_id),
    }


@router.post("/{vendor_id}/payments", status_code=status.HTTP_201_CREATED)
async def record_payment(
    vendor_id: uuid.UUID,
    payload: VendorPaymentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> dict:
    """Record money paid to a supplier.

    A CASH payment also leaves the till, so it is booked as a cash expense too —
    otherwise the drawer would be short by exactly this amount with nothing to
    explain it, which is the failure the cash work exists to prevent.
    """
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")

    row = VendorPayment(
        hotel_id=user.hotel_id,
        vendor_id=vendor_id,
        date=payload.date,
        amount=payload.amount,
        method=payload.method,
        reference=payload.reference,
        note=payload.note,
        created_by=user.id,
    )
    db.add(row)

    if payload.method == "CASH" and payload.category_id is not None:
        from app.expenses.models import Expense

        db.add(
            Expense(
                hotel_id=user.hotel_id,
                category_id=payload.category_id,
                date=payload.date,
                amount=payload.amount,
                payment_method="CASH",
                description=(
                    f"Paid {vendor.name}"
                    + (f" ({payload.reference})" if payload.reference else "")
                ),
                created_by=user.id,
            )
        )

    await db.commit()
    await db.refresh(row)
    return {
        "id": str(row.id),
        **(await ledger.balance(db, user.hotel_id, vendor_id)),
    }


# ── matching a supplier's wording to our own items (#6) ───────────────────


class ResolveIn(BaseModel):
    name: str
    vendor_id: uuid.UUID | None = None


class TeachIn(BaseModel):
    """Remember that this supplier's wording means this item."""

    name: str
    item_id: uuid.UUID
    vendor_id: uuid.UUID | None = None


@router.post("/resolve-item")
async def resolve_item(
    payload: ResolveIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> dict:
    """Which of our items does this supplier mean?

    Answers with a match AND the shortlist behind it, so the caller can either
    proceed or ask. It never invents an item: creating "Tomatos" beside
    "Tomato" would split one ingredient's stock across two rows and quietly
    corrupt costing everywhere it is used.
    """
    m = await matching.resolve(db, user.hotel_id, payload.name, vendor_id=payload.vendor_id)
    return {
        "matched": m.certain,
        "item_id": str(m.item_id) if m.item_id else None,
        "name": m.item_name or payload.name,
        "how": m.status,
        "candidates": [
            {"item_id": str(c.item_id), "name": c.name, "score": c.score}
            for c in m.candidates
        ],
    }


@router.post("/resolve-item/teach", status_code=status.HTTP_204_NO_CONTENT)
async def teach_item(
    payload: TeachIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> None:
    """Record a confirmed match so it is never asked about again.

    This is the half that compounds: every answer makes the next upload
    quieter, which is why it is worth more than a cleverer matcher.
    """
    item = await db.get(Item, payload.item_id)
    if item is None or item.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")

    saved = await matching.remember(
        db,
        user.hotel_id,
        payload.name,
        payload.item_id,
        vendor_id=payload.vendor_id,
        user_id=user.id,
    )
    if saved is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to remember.")

@router.get("/savings")
async def switching_savings(
    days: int = 90,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> dict:
    """What moving every item to its cheapest supplier is actually worth, a month.

    The page used to add per-unit savings together and call the total money —
    £1.00 per kg plus £0.61 per piece — and he asked what it meant. Nothing: you
    cannot spend it, budget with it or check it.

    This is money. For each item priced by two or more suppliers, the gap
    between what you pay and the cheapest, per BASE unit, times how much of it
    you actually received in the last `days`, expressed per month. Items you
    have never bought contribute nothing, which is correct — a saving on
    something you do not buy is not a saving.
    """
    rate = await volume.monthly_rate(db, user.hotel_id, days=days)
    by_item = await purchasing_service.item_suppliers(db, user.hotel_id)

    chains = await pack_service.levels_for(db, list(by_item.keys()))

    total = Decimal("0")
    counted = 0
    worst: dict | None = None

    for item_id, opts in by_item.items():
        if len(opts) < 2:
            continue
        rows = chains.get(item_id) or []
        levels = pack_service.as_levels(rows)
        pos = {r.id: r.position for r in rows}

        per_base = [
            (
                packs.price_per_base(
                    o["price_per_unit"], levels, pos.get(o.get("pack_level_id"), 0)
                ),
                o,
            )
            for o in opts
        ]
        cheapest, _ = min(per_base, key=lambda t: t[0])
        current = next(
            (p for p, o in per_base if o.get("is_preferred")),
            cheapest,
        )
        gap = current - cheapest
        if gap <= 0:
            continue

        monthly = gap * rate.get(item_id, Decimal("0"))
        counted += 1
        total += monthly
        if worst is None or monthly > worst["per_month"]:
            worst = {"item_id": str(item_id), "per_month": monthly}

    return {
        "days": days,
        "per_month": total.quantize(Decimal("0.01")),
        "items": counted,
        "worst": (
            {**worst, "per_month": worst["per_month"].quantize(Decimal("0.01"))}
            if worst
            else None
        ),
    }
