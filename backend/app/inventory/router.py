"""Inventory endpoints: items, stock movements, low-stock alerts, waste. Hotel-scoped."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import list_commit, list_io, lists, template_io
from app.core.config import settings
from app.core.database import get_db
from app.core.template_io import Column, TemplateSpec
from app.inventory import export, pack_service, service
from app.inventory.models import Item, MovementType, VendorItemAlias
from app.inventory.schemas import (
    CategoryMove,
    CategoryRename,
    ItemCreate,
    ItemOut,
    ItemUpdate,
    LowStockAlert,
    PackLevelOut,
    PurchaseByVendorRow,
    ReceiptLine,
    StockMovementCreate,
    StockMovementOut,
    WasteCreate,
    WasteList,
    WasteRow,
)
from app.vendors import service as vendor_service
from app.vendors.models import Vendor

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(prefix="/inventory", tags=["inventory"])


async def _item_out(db: AsyncSession, item) -> ItemOut:
    """One item, with its buying chain attached.

    Items created before the chain existed report their old pack_unit/pack_size
    as a single rung, so every screen reads one shape.
    """
    row = ItemOut.model_validate(item)
    chains = await pack_service.levels_for(db, [item.id])
    row.pack_levels = [
        PackLevelOut(**r) for r in pack_service.out_rows(item, chains.get(item.id))
    ]
    return row


@router.post("/items", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(
    payload: ItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> ItemOut:
    fields = payload.model_dump(exclude_none=True)
    # The chain is rows of its own, not a column, so it cannot ride along into
    # Item(**fields).
    levels = fields.pop("pack_levels", None)
    try:
        item = await service.create_item(db, user.hotel_id, **fields)
    except service.DuplicateItemError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    if levels is not None:
        await pack_service.set_levels(db, item, payload.pack_levels or [])
        await db.commit()
    return await _item_out(db, item)


@router.get("/items", response_model=list[ItemOut])
async def list_items(
    category: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[ItemOut]:
    items = await service.list_items(db, user.hotel_id, category=category)
    counts = await service.vendor_counts(db, user.hotel_id)
    pv_counts = await service.purchase_vendor_counts(db, user.hotel_id)
    best = await service.best_vendors(db, user.hotel_id)
    chains = await pack_service.levels_for(db, [i.id for i in items])
    out = []
    for i in items:
        row = ItemOut.model_validate(i)
        row.pack_levels = [
            PackLevelOut(**r) for r in pack_service.out_rows(i, chains.get(i.id))
        ]
        row.vendor_count = counts.get(i.id, 0)
        row.purchase_vendor_count = pv_counts.get(i.id, 0)
        chosen = best.get(i.id)
        if chosen:
            row.best_vendor, row.best_vendor_chosen, row.best_vendor_price = chosen
        out.append(row)
    return out


@router.get("/alerts/low-stock", response_model=list[LowStockAlert])
async def low_stock(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[LowStockAlert]:
    items = await service.low_stock_items(db, user.hotel_id)
    return [
        LowStockAlert(
            item_id=i.id,
            name=i.name,
            current_stock=i.current_stock,
            min_stock_level=i.min_stock_level,
            shortfall=i.min_stock_level - i.current_stock,
        )
        for i in items
    ]


@router.get("/items/{item_id}", response_model=ItemOut)
async def get_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> ItemOut:
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return ItemOut.model_validate(item)


@router.patch("/items/{item_id}", response_model=ItemOut)
async def update_item(
    item_id: uuid.UUID,
    payload: ItemUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> ItemOut:
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    fields = payload.model_dump(exclude_unset=True)
    # Rows, not a column — and `exclude_unset` matters here: a request that does
    # not mention pack_levels must leave the chain alone, while one that sends
    # an empty list is deliberately clearing it.
    sent_levels = "pack_levels" in fields
    fields.pop("pack_levels", None)
    try:
        item = await service.update_item(db, item, **fields)
    except service.DuplicateItemError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    if sent_levels:
        await pack_service.set_levels(db, item, payload.pack_levels or [])
        await db.commit()
    return await _item_out(db, item)


@router.get("/seed-starter")
async def seed_starter_preview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> dict:
    """The starter catalogue, flagged with what this hotel already has — feeds
    the pick-and-edit modal before anything is written."""
    from app.inventory.starter import STARTER_ITEMS

    existing = {
        n.lower()
        for (n,) in (
            await db.execute(select(Item.name).where(Item.hotel_id == user.hotel_id))
        ).all()
    }
    return {
        "items": [
            {"name": n, "unit": u, "category": c, "exists": n.lower() in existing}
            for n, u, c in STARTER_ITEMS
        ]
    }


class SeedItemIn(BaseModel):
    name: str
    unit: str
    category: str = "Other"


class SeedRequest(BaseModel):
    items: list[SeedItemIn] = []


@router.post("/seed-starter")
async def seed_starter(
    payload: SeedRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """One-click: add the curated starter catalogue (common restaurant items, name +
    unit + category only) so a new hotel isn't empty. Re-runnable — existing names
    are skipped. Prices/suppliers are left blank for the owner to set via Vendors."""
    chosen = (
        [(i.name, i.unit, i.category) for i in payload.items] if payload and payload.items else None
    )
    result = await service.seed_starter_items(db, user.hotel_id, chosen)
    if result["added"]:
        await audit.record(
            db, hotel_id=user.hotel_id, user=user, action="inventory.seed_starter",
            summary=f"Imported {len(result['added'])} starter items",
            entity_type="item", entity_id=None,
        )
    return {
        "added": len(result["added"]),
        "skipped": len(result["skipped"]),
        "names": result["added"],
    }


@router.get("/items/{item_id}/usage")
async def get_item_usage(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> dict:
    """How tied-in an item is (recipes / orders / stock movements / vendor links) so
    the UI can warn precisely before removing — and say whether it'll delete or archive."""
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return await service.item_usage(db, item)


@router.delete("/items/{item_id}")
async def delete_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:delete")),  # only "*" (Super Admin) grants this
) -> dict:
    """Remove an item (Super Admin only). Unused items are permanently deleted; items
    with recipe/order/stock history are ARCHIVED so the books stay intact."""
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    name = item.name
    result = await service.remove_item(db, item)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action=f"inventory.{result['action']}",
        summary=f"{result['action'].capitalize()} item: {name}",
        entity_type="item", entity_id=item_id,
    )
    return result


@router.post("/categories/rename")
async def rename_category(
    payload: CategoryRename,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Rename a category across all its items; renaming into an existing name merges them."""
    moved = await service.rename_category(db, user.hotel_id, payload.from_name, payload.to_name)
    return {"updated": moved}


@router.post("/categories/move")
async def move_category(
    payload: CategoryMove,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Move chosen items into a category, creating it if it is new.

    MOVE, never copy — see the note on the service function. The destination is
    just a string on the item, so filing things under an unused name is how a
    category gets created; that is what lets "make a new category and put these
    six things in it" be one action rather than two.
    """
    moved = await service.move_items_to_category(
        db, user.hotel_id, payload.item_ids, payload.to_name
    )
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="inventory.category.move",
        summary=f"Moved {moved} item{'' if moved == 1 else 's'} into {payload.to_name.strip()}",
        entity_type="item", entity_id=None,
    )
    return {"moved": moved, "category": payload.to_name.strip()}


@router.post(
    "/items/{item_id}/movements",
    response_model=StockMovementOut,
    status_code=status.HTTP_201_CREATED,
)
async def record_movement(
    item_id: uuid.UUID,
    payload: StockMovementCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> StockMovementOut:
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    if payload.movement_type == MovementType.PURCHASE_IN.value and payload.unit_cost is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unit_cost is required for PURCHASE_IN")
    try:
        movement = await service.record_movement(
            db,
            item,
            payload.movement_type,
            payload.quantity,
            unit_cost=payload.unit_cost,
            notes=payload.notes,
            created_by=user.id,
        )
    except service.InsufficientStockError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return StockMovementOut.model_validate(movement)


@router.get("/items/{item_id}/purchases-by-vendor", response_model=list[PurchaseByVendorRow])
async def purchases_by_vendor(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[PurchaseByVendorRow]:
    """A record of recent purchases of this item, per supplier (what you bought
    + at what price). Current stock stays one pool at weighted-average cost."""
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    rows = await service.purchases_by_vendor(db, item)
    return [PurchaseByVendorRow(**r) for r in rows]


@router.get("/receipts/{reference_id}", response_model=list[ReceiptLine])
async def receipt_lines(
    reference_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[ReceiptLine]:
    """The CHAIN: every item received on the same delivery/PO as a purchase — open a
    purchase up into the full receipt it came on. Hotel-scoped."""
    rows = await service.receipt_lines(db, user.hotel_id, reference_id)
    return [ReceiptLine(**r) for r in rows]


@router.get("/items/{item_id}/movements", response_model=list[StockMovementOut])
async def list_movements(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[StockMovementOut]:
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    movements = await service.list_movements(db, item_id)
    return [StockMovementOut.model_validate(m) for m in movements]


# ── Waste ────────────────────────────────────────────────────────────────────
@router.post("/waste", response_model=WasteRow, status_code=status.HTTP_201_CREATED)
async def log_waste(
    payload: WasteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> WasteRow:
    """Log spoilage/spillage/over-prep — decrements stock and records the £ value
    at weighted-average cost (so the Money page can show the leak)."""
    item = await service.get_item(db, payload.item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    try:
        mv = await service.record_waste(
            db, item, payload.quantity, payload.reason, created_by=user.id
        )
    except service.InsufficientStockError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    qty = abs(mv.quantity)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="stock.waste",
        summary=f"Logged waste: {qty} {item.unit} {item.name} ({payload.reason})",
        entity_type="item", entity_id=item.id,
    )
    return WasteRow(
        id=mv.id,
        item_id=item.id,
        item_name=item.name,
        unit=item.unit,
        quantity=qty,
        unit_cost=mv.unit_cost,
        value=qty * (mv.unit_cost or 0),
        reason=mv.notes,
        created_at=mv.created_at,
    )


@router.get("/waste", response_model=WasteList)
async def list_waste(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> WasteList:
    rows = await service.list_waste(db, user.hotel_id, date_from, date_to)
    out = [WasteRow.model_validate(r) for r in rows]
    total = sum((r.value for r in out), start=Decimal("0"))
    return WasteList(total_value=total, entry_count=len(out), rows=out)


# ── Exports (stock valuation + waste log) ────────────────────────────────────
def _file(content: bytes, media_type: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/items.csv")
async def items_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    items = await service.list_items(db, user.hotel_id)
    suppliers = await service.best_vendors(db, user.hotel_id)
    return _file(export.items_to_csv(items, suppliers), "text/csv", "mise-stock-valuation.csv")


@router.get("/items.xlsx")
async def items_xlsx(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    items = await service.list_items(db, user.hotel_id)
    suppliers = await service.best_vendors(db, user.hotel_id)
    return _file(export.items_to_xlsx(items, suppliers), XLSX_MIME, "mise-stock-valuation.xlsx")


@router.get("/waste.csv")
async def waste_csv(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    rows = await service.list_waste(db, user.hotel_id, date_from, date_to)
    return _file(export.waste_to_csv(rows, date_from, date_to), "text/csv", "mise-waste-log.csv")


@router.get("/waste.xlsx")
async def waste_xlsx(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    rows = await service.list_waste(db, user.hotel_id, date_from, date_to)
    return _file(export.waste_to_xlsx(rows, date_from, date_to), XLSX_MIME, "mise-waste-log.xlsx")


# ── Strict import template (Excel/CSV) ────────────────────────────────────────
# NO price column — prices live with the supplier (single source of truth). The
# optional Supplier column only LINKS an existing vendor price: if that vendor
# already prices the item we set it as the ★ chosen one; otherwise we tell you why.
def _exp(key: str) -> str:
    """The header the exporter writes this field under. Lower-cased because the
    matcher normalises; missing keys fall back to the key itself rather than
    raising, so adding a column to the template never breaks the export."""
    return export.ITEM_IMPORT_HEADERS.get(key, key).lower()


ITEMS_TEMPLATE = TemplateSpec(
    name="Inventory items",
    subtitle=(
        "One row per item. Name + Unit required (*). Supplier is optional — its price "
        "is read from Vendors (you never type a price here)."
    ),
    # ⚠️ EVERY COLUMN CARRIES ITS EXPORT HEADER AS AN ALIAS, read from
    # `export.ITEM_IMPORT_HEADERS` rather than retyped. His rule is "whatever we
    # export we can import and use the same", and the way that broke was two
    # lists of English in two files: the exporter said "In stock", the importer
    # accepted "Opening stock" and four aliases that did not include it, and the
    # quantity column was dropped on every single re-import WITHOUT AN ERROR.
    #
    # Reading the aliases from the exporter makes the round trip structural. A
    # header renamed in one place is renamed in both, and `test_round_trip`
    # fails if anybody splits them again.
    columns=[
        Column("name", "Name", required=True,
               aliases=("item", "product", "ingredient", _exp("name"))),
        Column("unit", "Unit", required=True, aliases=("uom", "units", _exp("unit"))),
        Column("category", "Category", aliases=("type", "group", _exp("category"))),
        Column("current_stock", "Opening stock", kind="number",
               aliases=("stock", "quantity", "qty", "opening", _exp("current_stock"))),
        Column("supplier", "Supplier", aliases=("vendor", "supplier name", _exp("supplier"))),
    ],
    sample_rows=[
        ["Basmati Rice", "kg", "Dry Goods", 25, "Fresh Farms"],
        ["Paneer", "kg", "Dairy", 10, ""],
        ["Chicken", "kg", "Meat", 8, ""],
    ],
)


async def _find_vendor(db: AsyncSession, hotel_id: uuid.UUID, name: str):
    """Find a vendor by normalised (trim + case-fold) name. Does NOT create one —
    a missing supplier is reported so the user adds it on Vendors."""
    # STRIP THE CHOSEN MARK. The exporter writes "★ Fresh Farms" so a person can
    # see which supplier is selected; this matched names exactly, so every
    # starred supplier failed to resolve and the re-import produced items with
    # no vendor at all — silently, because a missing supplier is only "reported"
    # and never fails the row.
    nl = name.strip().lstrip(export.CHOSEN_MARK.strip()).strip().casefold()
    vendors = await vendor_service.list_vendors(db, hotel_id)
    return next((v for v in vendors if v.name and v.name.strip().casefold() == nl), None)



def _close(a: str, b: str) -> float:
    """How alike two supplier names are, 0..1.

    `SequenceMatcher` on the case-folded, punctuation-stripped names. Good
    enough to catch a typo and a missing "Ltd", and it never decides
    anything on its own — everything above the threshold is SHOWN, not
    applied.
    """
    import re as _re
    from difflib import SequenceMatcher

    def norm(s: str) -> str:
        return _re.sub(r"[^a-z0-9]+", " ", (s or "").casefold()).strip()

    x, y = norm(a), norm(b)
    if not x or not y:
        return 0.0
    if x == y:
        return 1.0
    # A containment counts for a lot: "Fresh Foods" vs "Fresh Foods Ltd".
    if x in y or y in x:
        return max(0.9, SequenceMatcher(None, x, y).ratio())
    return SequenceMatcher(None, x, y).ratio()


#: Below this a name is "unknown" rather than "did you mean". Set high on
#: purpose: a wrong suggestion that looks confident is worse than no
#: suggestion, because he will accept it.
_SUGGEST_AT = 0.82


async def _match_suppliers(db, hotel_id, plan: dict) -> dict:
    """Annotate each preview row with the supplier it would link to.

    Mutates and returns the plan dict. The resolution uses the SAME rule the
    commit uses, so the preview cannot promise a link the write will not
    make — a preview that disagrees with the write is worse than no preview.
    """
    vendors = await vendor_service.list_vendors(db, hotel_id)
    known = {(v.name or "").strip().casefold(): v for v in vendors if v.name}

    for row in plan.get("rows") or []:
        given = str((row.get("values") or {}).get("supplier") or "").strip()
        given = given.lstrip(export.CHOSEN_MARK.strip()).strip()
        if not given:
            row["supplier_match"] = {"given": "", "status": "blank"}
            continue

        hit = known.get(given.casefold())
        if hit is not None:
            row["supplier_match"] = {
                "given": given,
                "status": "matched",
                "vendor_id": str(hit.id),
                "matched_name": hit.name,
            }
            continue

        scored = sorted(
            ((_close(given, v.name or ""), v) for v in vendors),
            key=lambda p: p[0],
            reverse=True,
        )
        best = scored[0] if scored else None
        if best and best[0] >= _SUGGEST_AT:
            row["supplier_match"] = {
                "given": given,
                "status": "suggested",
                # NOT APPLIED. Shown, with its own button. Attaching a price
                # list to the wrong supplier is the one mistake here that
                # costs money quietly.
                "vendor_id": str(best[1].id),
                "matched_name": best[1].name,
                "suggestions": [
                    {"name": v.name, "id": str(v.id)} for s, v in scored[:3] if s >= 0.6
                ],
            }
        else:
            row["supplier_match"] = {
                "given": given,
                "status": "unknown",
                "suggestions": [
                    {"name": v.name, "id": str(v.id)} for s, v in scored[:3] if s >= 0.6
                ],
            }
    return plan

@router.get("/template.xlsx")
async def items_template_xlsx(user: User = Depends(require("inventory:read"))) -> Response:
    return _file(
        template_io.template_xlsx(ITEMS_TEMPLATE), XLSX_MIME, "mise-inventory-template.xlsx"
    )


@router.get("/template.csv")
async def items_template_csv(user: User = Depends(require("inventory:read"))) -> Response:
    return _file(
        template_io.template_csv(ITEMS_TEMPLATE), "text/csv", "mise-inventory-template.csv"
    )


@router.get("/template.pdf")
async def items_template_pdf(user: User = Depends(require("inventory:read"))) -> Response:
    """A printable reference of the template (fill the Excel/CSV to actually import)."""
    return _file(
        template_io.template_pdf(ITEMS_TEMPLATE), "application/pdf", "mise-inventory-template.pdf"
    )


# ── the round trip, on the same machinery as the other four lists ─────────
#
#     "there is strick import efatrue whic donstn not accepting the doc which
#      i exported ealier(waht the hell)"
#
# Inventory already had an importer, and it was the careful one — its column
# aliases are read from the exporter so the two cannot drift. What it did NOT
# have was a preview: `/import-template/commit` created what it could and put
# the duplicates in a `skipped` list nobody was shown. That is the exact
# failure the preview screen exists to replace, still live on the one list he
# managed to export.
#
# `/import-template` stays — other callers use it. This is the pair `/setup`
# and the assistant speak, and the pair that shows its work.


class _InvCommitIn(BaseModel):
    rows: list[dict] = Field(default_factory=list)
    source: str = "file"


async def _items_now(db: AsyncSession, hotel_id: uuid.UUID) -> list:
    """Every item, active or not, WITH ITS SUPPLIER RESOLVED.

    Archived counts: an archived item is still a duplicate, and re-creating
    one is how a restaurant ends up with two Paneers, one of which holds all
    the history.

    WARNING: `supplier` IS NOT A COLUMN ON Item. It is resolved through
    `best_vendors` — which is exactly what the EXPORTER does. Without this the
    comparison read `getattr(item, "supplier", None)`, got None for every
    single item, and so flagged every stock line that HAS a supplier as
    changed, on every re-import, forever. Hanging the resolved name on the
    instance keeps `classify`'s generic lookup working AND keeps the update
    target an ORM row rather than a dict.
    """
    items = await service.list_items(db, hotel_id, active_only=False)
    chosen = await service.best_vendors(db, hotel_id)
    for it in items:
        picked = chosen.get(it.id)
        # No chosen-mark here. The star is decoration for a human reading a
        # spreadsheet, and it is stripped off the incoming side too, so both
        # sides of the comparison are plain supplier names.
        it.supplier = picked[0] if picked else None
    return items


class _ItemsRowsIn(BaseModel):
    """Rows from typing, or from the AI reading something. Not from a file."""

    rows: list[dict] = Field(default_factory=list)


@router.post("/import/preview-rows")
async def preview_items_rows(
    payload: _ItemsRowsIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Classify rows that never came from a file. Writes nothing.

    Typing and the AI both produce rows, and `classify()` takes rows — it was
    split out of `build_plan` for precisely this and then had no HTTP door, so
    the only way to reach a preview was to upload something. Typed entry had
    no duplicate check at all.

    Same classify, same rules, same screen, same commit endpoint. A second
    path here would be the same thing built twice at half the quality.
    """
    rows = [r for r in payload.rows if isinstance(r, dict)][:list_commit.MAX_COMMIT_ROWS]
    allowed = {f.key for f in lists.ITEMS.fields}
    cleaned = [{k: v for k, v in r.items() if k in allowed} for r in rows]
    existing = await _items_now(db, user.hotel_id)
    plan = list_io.classify(cleaned, lists.ITEMS, existing)
    return await _match_suppliers(db, user.hotel_id, plan.as_dict())


@router.post("/import/read-ai")
async def read_inventory_with_ai(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Read ANY documents as this list, with the AI. Writes nothing.

        "everytime they wont have a tempate ... let them add whatever
         document they have like csv image pdf word whatsever"

    A spreadsheet with unfamiliar headings, a supplier's PDF, twenty
    photographs of a handwritten book. The deterministic reader runs first
    and is free; this is for everything it cannot parse, and telling somebody
    to go and fill in a blank template instead is the extra job he is
    describing.

    N FILES, ONE PREVIEW. Each is read separately — a photo of page three
    knows nothing about page two — then pooled before a single `classify`,
    so a dish appearing on two photographs is caught as a duplicate of itself
    rather than added twice.
    """
    from app.assistant import docbytes, ingest
    from app.assistant.provider import ProviderError

    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No files")
    if len(files) > 25:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That is more than 25 files. Send them in a couple of goes so you "
            "can check each batch.",
        )

    rows: list[dict] = []
    read: list[str] = []
    failed: list[dict] = []

    for f in files:
        data = await f.read()
        name = f.filename or "file"
        if not data:
            continue
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            failed.append({"name": name, "why": "too large"})
            continue
        if docbytes.is_unreadable(name):
            failed.append({"name": name, "why": "that is an archive or a video"})
            continue
        try:
            got = await ingest.read_as(data, f.content_type or "", name, "inventory")
        except ProviderError as exc:
            # ONE BAD FILE MUST NOT LOSE THE OTHER NINETEEN. He is uploading a
            # stack of photographs; failing the batch on the blurry one is
            # the worst possible way to spend his afternoon.
            failed.append({"name": name, "why": str(exc)[:120]})
            continue
        rows.extend(got)
        read.append(name)

    if not rows:
        return {
            "plan": None,
            "read": read,
            "failed": failed,
            "why": (
                "I read those, but couldn't find any inventory in them. If they "
                "are the right documents, tell me what I missed and I'll look "
                "again."
            ),
        }

    existing = await _items_now(db, user.hotel_id)
    plan = list_io.classify(rows[:list_commit.MAX_COMMIT_ROWS], lists.ITEMS, existing)
    matched = await _match_suppliers(db, user.hotel_id, plan.as_dict())
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="inventory.read_ai",
        summary=(
            f"AI read {len(read)} document(s) as inventory "
            f"({len(rows)} rows, nothing saved yet)"
        ),
    )
    return {
        "plan": matched,
        "read": read,
        "failed": failed,
        "truncated": len(rows) > list_commit.MAX_COMMIT_ROWS,
    }


@router.post("/import/inspect")
async def inspect_inventory_import(
    file: UploadFile = File(...),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """What is in this file, and what we would guess each column means.

    Reads nothing from the database and writes nothing. It exists so a file
    whose headings we do not recognise is a QUESTION rather than a dead end —
    and so a guess is never silently acted on.
    """
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_mb} MB",
        )
    return template_io.inspect_upload(
        data, file.filename or "", file.content_type or "", lists.ITEMS.template()
    )


@router.post("/import/preview")
async def preview_item_import(
    file: UploadFile = File(...),
    # THE MAPPING THE PERSON CONFIRMED, as a JSON string: this request is
    # multipart because it carries a file, and multipart has no objects.
    mapping: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """What would happen to your stock list. Writes nothing."""
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_mb} MB",
        )
    existing = await _items_now(db, user.hotel_id)
    plan = list_io.build_plan(
        data, file.filename or "", file.content_type or "", lists.ITEMS,
        existing, list_io._mapping(mapping),
    )
    # WHICH SUPPLIER EACH ITEM LANDS ON, before it is saved rather than in a
    # capped list of notes afterwards.
    return await _match_suppliers(db, user.hotel_id, plan.as_dict())


@router.post("/import/commit")
async def commit_item_import(
    payload: _InvCommitIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Write the decided items, and link suppliers where we can."""
    decisions, errors = list_commit.clean_decisions(payload.rows, lists.ITEMS)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(errors[:3]))

    existing = await _items_now(db, user.hotel_id)
    notes: list[str] = []

    def _fields(values: dict) -> dict:
        # `supplier` IS NOT A COLUMN ON Item. It names a vendor, and the link
        # is made after the row exists — passing it to the constructor would
        # be a TypeError on every row that named one.
        return {
            k: v for k, v in values.items()
            if k != "supplier" and v is not None and v != ""
        }

    async def _link(item, values: dict) -> None:
        """Best-effort supplier link. A missing vendor is REPORTED, never
        invented: creating a supplier as a side effect of a stock import is
        how a vendor list fills with typos nobody chose."""
        name = str(values.get("supplier") or "").strip()
        if not name or item is None:
            return
        vendor = await _find_vendor(db, user.hotel_id, name)
        if vendor is None:
            notes.append(f"{item.name}: no supplier called “{name}” — add it on Vendors")

    async def _create(values: dict):
        item = await service.create_item(db, user.hotel_id, **_fields(values))
        await _link(item, values)
        return item

    async def _update(target, values: dict):
        item = await service.update_item(db, target, **_fields(values))
        await _link(item, values)
        return item

    report = await list_commit.apply(
        decisions, lists.ITEMS, existing, create=_create, update=_update
    )
    out = report.as_dict(sent=len(decisions))
    out["notes"] = notes[:20]
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="inventory.import",
        summary=(
            f"Imported stock from {payload.source}: {out['counts']['created']} added, "
            f"{out['counts']['updated']} updated, {out['counts']['failed']} failed"
        ),
    )
    return out


@router.post("/import-template")
async def import_template(
    file: UploadFile = File(...),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Validate a filled Excel/CSV template (items only). On a mismatch (missing
    Name/Unit columns, a non-number where a number's expected) return the exact errors
    (422) so the user can fix + re-upload. Returns the parsed rows (writes nothing)."""
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB"
        )
    rows, errors = template_io.parse_upload(
        data, file.filename or "", file.content_type or "", ITEMS_TEMPLATE
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})
    return {"kind": "items", "rows": rows}


class _ImportCommit(BaseModel):
    rows: list[dict]


@router.post("/import-template/commit")
async def import_template_commit(
    payload: _ImportCommit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Create the validated items (no AI). A Supplier column, if filled, LINKS the
    item to that vendor's existing price (never types one): vendor missing or the
    vendor doesn't price the item → reported in `notes`. Existing items are skipped
    but still get the supplier link if possible."""
    created: list[str] = []
    skipped: list[str] = []
    linked: list[str] = []
    notes: list[str] = []
    for row in payload.rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        fields = {
            k: row[k] for k in ("name", "unit", "category", "current_stock")
            if row.get(k) not in (None, "")
        }
        try:
            item = await service.create_item(db, user.hotel_id, **fields)
            created.append(name)
        except service.DuplicateItemError:
            item = await service.get_item_by_name(db, user.hotel_id, name)
            skipped.append(name)
            if item is None:
                continue

        supplier = str(row.get("supplier") or "").strip()
        if not supplier:
            continue
        vendor = await _find_vendor(db, user.hotel_id, supplier)
        if vendor is None:
            notes.append(f"{name}: supplier “{supplier}” not found — add it on Vendors first.")
            continue
        # set_preferred only succeeds if that vendor already prices this item.
        if await vendor_service.set_preferred_vendor(db, user.hotel_id, item.id, vendor.id):
            linked.append(name)
            vis = await vendor_service.list_vendor_items(db, vendor.id)
            vi = next((v for v in vis if v.item_id == item.id), None)
            if vi is not None and vi.price_per_unit is not None and not item.average_cost:
                # Per BASE unit. average_cost multiplies against stock, which is
                # counted in base units — seeding it with a pack quote values
                # opening stock at the price of a whole box per gram.
                convert = await pack_service.per_base_prices(db, [item.id])
                await service.update_item(
                    db,
                    item,
                    average_cost=convert(item.id, vi.price_per_unit, vi.pack_level_id),
                )
        else:
            notes.append(
                f"{name}: {vendor.name} doesn’t list this item yet — set its price on Vendors."
            )
    if created or linked:
        await audit.record(
            db, hotel_id=user.hotel_id, user=user, action="inventory.import",
            summary=f"Imported {len(created)} items from a template", entity_type="items",
        )
    return {"created": created, "skipped": skipped, "linked": linked, "notes": notes}


# ── Supplier name translations ──────────────────────────────────────────────
# A vendor's "Tomatos 1kg Box" means your "Tomato". Once confirmed, that answer
# is remembered so the same question is never asked twice. Kept visible and
# deletable on purpose: a remembered decision that is WRONG would otherwise be
# wrong silently for ever, which is the one real risk of making them permanent.


@router.get("/aliases")
async def list_aliases(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[dict]:
    """Every supplier wording this hotel has confirmed, newest first."""
    rows = await db.execute(
        select(VendorItemAlias, Item, Vendor)
        .join(Item, VendorItemAlias.item_id == Item.id)
        .outerjoin(Vendor, VendorItemAlias.vendor_id == Vendor.id)
        .where(VendorItemAlias.hotel_id == user.hotel_id)
        .order_by(VendorItemAlias.created_at.desc())
    )
    return [
        {
            "id": str(alias.id),
            # What the supplier actually wrote — the normalised form is not
            # recognisable to a human reviewing this list.
            "supplier_wording": alias.original_text or alias.alias_text,
            "item_id": str(item.id),
            "item_name": item.name,
            "vendor_id": str(vendor.id) if vendor else None,
            "vendor_name": vendor.name if vendor else "any supplier",
            "created_at": alias.created_at.isoformat(),
        }
        for alias, item, vendor in rows.all()
    ]


@router.delete("/aliases/{alias_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alias(
    alias_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> Response:
    """Forget one translation. The next import will ask again."""
    row = await db.get(VendorItemAlias, alias_id)
    if row is None or row.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such alias")
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
