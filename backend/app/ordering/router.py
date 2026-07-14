"""Online ordering routers.

`router`        — hotel side (auth): menu CRUD + the live orders board.
`public_router` — the customer side (NO auth): browse a hotel's menu, place an
                  order (prices come from OUR db, never the client), track it.
"""
import logging
import secrets
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core import notify
from app.core.config import settings
from app.core.database import get_db
from app.hotels.models import Hotel
from app.ordering.models import ORDER_FLOW, MenuItem, Order, OrderItem, OrderStatus
from app.ordering.rider_models import Rider
from app.ordering.rider_router import build_management_endpoints

log = logging.getLogger("mise.ordering")
router = APIRouter(prefix="/ordering", tags=["ordering"])
public_router = APIRouter(prefix="/public/order", tags=["ordering-public"])

FULFILMENTS = {"PICKUP", "DELIVERY"}


# ── schemas ───────────────────────────────────────────────────────────────────
class MenuItemIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    price: Decimal = Field(gt=0, le=Decimal("9999"))
    category: str = Field(default="Mains", max_length=60)
    emoji: str | None = Field(default=None, max_length=8)
    is_available: bool = True
    recipe_id: uuid.UUID | None = None


class MenuItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    price: Decimal | None = Field(default=None, gt=0, le=Decimal("9999"))
    category: str | None = Field(default=None, max_length=60)
    emoji: str | None = Field(default=None, max_length=8)
    is_available: bool | None = None


class MenuItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str | None
    price: Decimal
    category: str
    emoji: str | None
    is_available: bool
    recipe_id: uuid.UUID | None


class PublicOrderLine(BaseModel):
    menu_item_id: uuid.UUID
    quantity: int = Field(ge=1, le=50)


class PublicOrderIn(BaseModel):
    customer_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    fulfilment: str = "PICKUP"
    address_text: str | None = Field(default=None, max_length=500)
    address_lat: Decimal | None = None
    address_lng: Decimal | None = None
    note: str | None = Field(default=None, max_length=500)
    items: list[PublicOrderLine] = Field(min_length=1, max_length=50)


def _order_out(o: Order, rider_name: str | None = None) -> dict:
    return {
        "id": str(o.id),
        "rider_name": rider_name,
        "code": o.code,
        "status": o.status,
        "fulfilment": o.fulfilment,
        "customer_name": o.customer_name,
        "phone": o.phone,
        "address_text": o.address_text,
        "address_lat": str(o.address_lat) if o.address_lat is not None else None,
        "address_lng": str(o.address_lng) if o.address_lng is not None else None,
        "note": o.note,
        "subtotal": str(o.subtotal),
        "delivery_fee": str(o.delivery_fee),
        "total": str(o.total),
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "items": [
            {
                "name": i.name,
                "quantity": i.quantity,
                "unit_price": str(i.unit_price),
                "line_total": str(i.line_total),
            }
            for i in o.items
        ],
    }


# ── hotel side: kitchen settings (prep estimate + busy switch) ───────────────
class OrderingSettings(BaseModel):
    prep_minutes: int | None = Field(default=None, ge=5, le=180)
    ordering_paused: bool | None = None


@router.get("/settings")
async def get_settings(
    db: AsyncSession = Depends(get_db), user: User = Depends(require("orders:read"))
) -> dict:
    hotel = await db.get(Hotel, user.hotel_id)
    return {"prep_minutes": hotel.prep_minutes, "ordering_paused": hotel.ordering_paused}


@router.patch("/settings")
async def patch_settings(
    payload: OrderingSettings,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("orders:write")),
) -> dict:
    hotel = await db.get(Hotel, user.hotel_id)
    if payload.prep_minutes is not None:
        hotel.prep_minutes = payload.prep_minutes
    if payload.ordering_paused is not None:
        hotel.ordering_paused = payload.ordering_paused
    await db.commit()
    return {"prep_minutes": hotel.prep_minutes, "ordering_paused": hotel.ordering_paused}


# ── hotel side: menu ─────────────────────────────────────────────────────────
@router.get("/menu", response_model=list[MenuItemOut])
async def list_menu(
    db: AsyncSession = Depends(get_db), user: User = Depends(require("orders:read"))
) -> list[MenuItemOut]:
    rows = (
        (
            await db.execute(
                select(MenuItem)
                .where(MenuItem.hotel_id == user.hotel_id)
                .order_by(MenuItem.category, MenuItem.sort_order, MenuItem.name)
            )
        )
        .scalars()
        .all()
    )
    return [MenuItemOut.model_validate(m) for m in rows]


@router.post("/menu", response_model=MenuItemOut, status_code=status.HTTP_201_CREATED)
async def create_menu_item(
    payload: MenuItemIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("orders:write")),
) -> MenuItemOut:
    item = MenuItem(hotel_id=user.hotel_id, **payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return MenuItemOut.model_validate(item)


@router.post("/menu/import-recipes", response_model=list[MenuItemOut])
async def import_from_recipes(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("orders:write")),
) -> list[MenuItemOut]:
    """One click: every priced recipe that isn't on the menu yet becomes a
    menu item (selling_price → price). The costing link rides along."""
    from app.recipes.models import Recipe

    existing = {
        r
        for (r,) in (
            await db.execute(
                select(MenuItem.recipe_id).where(
                    MenuItem.hotel_id == user.hotel_id, MenuItem.recipe_id.is_not(None)
                )
            )
        ).all()
    }
    recipes = (
        (
            await db.execute(
                select(Recipe).where(
                    Recipe.hotel_id == user.hotel_id,
                    Recipe.selling_price.is_not(None),
                    Recipe.selling_price > 0,
                )
            )
        )
        .scalars()
        .all()
    )
    created: list[MenuItem] = []
    for r in recipes:
        if r.id in existing:
            continue
        item = MenuItem(
            hotel_id=user.hotel_id,
            name=r.name,
            price=r.selling_price,
            category=getattr(r, "category", None) or "Mains",
            recipe_id=r.id,
        )
        db.add(item)
        created.append(item)
    await db.commit()
    for item in created:
        await db.refresh(item)
    return [MenuItemOut.model_validate(m) for m in created]


@router.patch("/menu/{item_id}", response_model=MenuItemOut)
async def update_menu_item(
    item_id: uuid.UUID,
    payload: MenuItemPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("orders:write")),
) -> MenuItemOut:
    item = (
        await db.execute(
            select(MenuItem).where(MenuItem.id == item_id, MenuItem.hotel_id == user.hotel_id)
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Menu item not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return MenuItemOut.model_validate(item)


@router.delete("/menu/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_menu_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("orders:write")),
) -> None:
    item = (
        await db.execute(
            select(MenuItem).where(MenuItem.id == item_id, MenuItem.hotel_id == user.hotel_id)
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Menu item not found")
    await db.delete(item)
    await db.commit()


# ── hotel side: the live orders board ────────────────────────────────────────
@router.get("/orders")
async def list_orders(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("orders:read")),
) -> dict:
    rows = (
        (
            await db.execute(
                select(Order)
                .where(Order.hotel_id == user.hotel_id)
                .order_by(Order.created_at.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    today = func.date(Order.created_at) == func.current_date()
    live = [
        s.value
        for s in OrderStatus
        if s.value not in ("COMPLETED", "REJECTED", "CANCELLED")
    ]
    vitals = {
        "today_orders": (
            await db.execute(
                select(func.count(Order.id)).where(Order.hotel_id == user.hotel_id, today)
            )
        ).scalar_one(),
        "today_revenue": str(
            (
                await db.execute(
                    select(func.coalesce(func.sum(Order.total), 0)).where(
                        Order.hotel_id == user.hotel_id,
                        today,
                        Order.status.not_in(["REJECTED", "CANCELLED"]),
                    )
                )
            ).scalar_one()
        ),
        "live": (
            await db.execute(
                select(func.count(Order.id)).where(
                    Order.hotel_id == user.hotel_id, Order.status.in_(live)
                )
            )
        ).scalar_one(),
    }
    rider_ids = {o.rider_id for o in rows if o.rider_id}
    names: dict = {}
    if rider_ids:
        names = {
            r.id: r.name
            for r in (
                await db.execute(select(Rider).where(Rider.id.in_(rider_ids)))
            ).scalars().all()
        }
    return {
        "orders": [_order_out(o, names.get(o.rider_id)) for o in rows],
        "vitals": vitals,
    }


class OrderPatch(BaseModel):
    status: str


@router.patch("/orders/{order_id}")
async def move_order(
    order_id: uuid.UUID,
    payload: OrderPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("orders:write")),
) -> dict:
    order = (
        await db.execute(
            select(Order).where(Order.id == order_id, Order.hotel_id == user.hotel_id)
        )
    ).scalar_one_or_none()
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    allowed = ORDER_FLOW.get(order.status, [])
    if payload.status not in allowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Can't move {order.status} → {payload.status} (allowed: {', '.join(allowed) or '—'})",
        )
    order.status = payload.status
    await db.commit()
    if payload.status == OrderStatus.COMPLETED.value:
        await _record_sale(db, order)
    return _order_out(order)


async def _record_sale(db: AsyncSession, order: Order) -> None:
    """One-stop magic: a COMPLETED online order books itself into the money
    engine — the 'Online Orders' sales channel gets a line (feeds Sales & Cash,
    Money and the P&L), and recipe-linked items bump DishSale so menu
    engineering learns what actually sells. Best-effort: never blocks the flow."""
    from datetime import UTC, datetime

    from app.sales.models import DailySales, DishSale, SalesChannel, SalesLine

    try:
        today = datetime.now(UTC).date()
        channel = (
            await db.execute(
                select(SalesChannel).where(
                    SalesChannel.hotel_id == order.hotel_id,
                    SalesChannel.name == "Online Orders",
                )
            )
        ).scalar_one_or_none()
        if channel is None:
            channel = SalesChannel(hotel_id=order.hotel_id, name="Online Orders")
            db.add(channel)
            await db.flush()
        day = (
            await db.execute(
                select(DailySales).where(
                    DailySales.hotel_id == order.hotel_id, DailySales.date == today
                )
            )
        ).scalar_one_or_none()
        if day is None:
            day = DailySales(hotel_id=order.hotel_id, date=today)
            db.add(day)
            await db.flush()
        db.add(
            SalesLine(
                daily_sales_id=day.id,
                channel_id=channel.id,
                gross_amount=order.total,
                payment_method="CASH",  # pay-at-counter/delivery for now
                notes=f"Online order {order.code}",
            )
        )
        # recipe-linked lines feed menu engineering (popularity × margin)
        menu_ids = [i.menu_item_id for i in order.items if i.menu_item_id]
        if menu_ids:
            rows = (
                await db.execute(select(MenuItem).where(MenuItem.id.in_(menu_ids)))
            ).scalars().all()
            recipe_by_menu = {m.id: m.recipe_id for m in rows if m.recipe_id}
            for line in order.items:
                rid = recipe_by_menu.get(line.menu_item_id)
                if not rid:
                    continue
                ds = (
                    await db.execute(
                        select(DishSale).where(
                            DishSale.hotel_id == order.hotel_id,
                            DishSale.recipe_id == rid,
                            DishSale.date == today,
                        )
                    )
                ).scalar_one_or_none()
                if ds is None:
                    db.add(
                        DishSale(
                            hotel_id=order.hotel_id, recipe_id=rid,
                            date=today, qty_sold=line.quantity,
                        )
                    )
                else:
                    ds.qty_sold += line.quantity
        await db.commit()
    except Exception:  # noqa: BLE001 — booking the sale must never break the board
        log.exception("online order -> sales bridge failed for %s", order.code)
        await db.rollback()


# ── public side ───────────────────────────────────────────────────────────────
@public_router.get("/{hotel_id}")
async def public_menu(hotel_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None or not hotel.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This kitchen isn't taking orders")
    items = (
        (
            await db.execute(
                select(MenuItem)
                .where(MenuItem.hotel_id == hotel_id, MenuItem.is_available.is_(True))
                .order_by(MenuItem.category, MenuItem.sort_order, MenuItem.name)
            )
        )
        .scalars()
        .all()
    )
    return {
        "hotel": {"id": str(hotel.id), "name": hotel.name, "city": hotel.city,
                  "currency": hotel.base_currency,
                  "prep_minutes": hotel.prep_minutes, "paused": hotel.ordering_paused},
        "menu": [MenuItemOut.model_validate(m).model_dump(mode="json") for m in items],
    }


@public_router.post("/{hotel_id}", status_code=status.HTTP_201_CREATED)
async def place_order(
    hotel_id: uuid.UUID, payload: PublicOrderIn, db: AsyncSession = Depends(get_db)
) -> dict:
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None or not hotel.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This kitchen isn't taking orders")
    if hotel.ordering_paused:
        raise HTTPException(
            status.HTTP_423_LOCKED,
            "The kitchen is slammed right now and has paused new orders — try again shortly",
        )
    if payload.fulfilment not in FULFILMENTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown fulfilment")
    if payload.fulfilment == "DELIVERY" and not (payload.address_text or "").strip():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Delivery needs an address"
        )

    # Prices come from OUR menu — a tampered client can't set its own.
    wanted = {line.menu_item_id: line.quantity for line in payload.items}
    rows = (
        (
            await db.execute(
                select(MenuItem).where(
                    MenuItem.hotel_id == hotel_id,
                    MenuItem.id.in_(wanted),
                    MenuItem.is_available.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(rows) != len(wanted):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Some items just went off the menu — refresh and try again",
        )

    subtotal = Decimal("0")
    order = Order(
        hotel_id=hotel_id,
        code=f"M-{secrets.randbelow(9000) + 1000}",
        customer_name=payload.customer_name.strip(),
        phone=payload.phone.strip(),
        email=(payload.email or "").strip().lower() or None,
        fulfilment=payload.fulfilment,
        address_text=(payload.address_text or "").strip() or None,
        address_lat=payload.address_lat,
        address_lng=payload.address_lng,
        note=(payload.note or "").strip() or None,
        subtotal=Decimal("0"),
        total=Decimal("0"),
    )
    db.add(order)
    await db.flush()
    for m in rows:
        qty = wanted[m.id]
        line = (m.price * qty).quantize(Decimal("0.01"))
        subtotal += line
        db.add(
            OrderItem(
                order_id=order.id, menu_item_id=m.id, name=m.name,
                unit_price=m.price, quantity=qty, line_total=line,
            )
        )
    order.subtotal = subtotal
    order.total = subtotal + order.delivery_fee
    await db.commit()

    # Ring the kitchen (owners/managers with the new_order alert on).
    await notify.email_hotel_admins(
        db,
        hotel_id,
        f"🛎️ New order {order.code}: {order.customer_name} · £{order.total}",
        f"{order.customer_name} placed {payload.fulfilment.lower()} order {order.code} "
        f"for £{order.total}. Open Mise → Online Orders to confirm it.",
        html=notify.render_email(
            badge="🛎️ New order",
            heading="Order in — the board is lit!",
            intro=f"<b>{order.customer_name}</b> just ordered from your online menu. "
            "Confirm it fast — quick kitchens win repeat customers.",
            rows=[
                ("Order", order.code),
                ("Type", payload.fulfilment.title()),
                ("Items", str(sum(wanted.values()))),
                ("Total", f"£{order.total}"),
            ],
            cta_label="Open the orders board",
            cta_url=f"{settings.app_base_url}/orders",
        ),
        pref_key="new_order",
        background=True,
    )
    return {"id": str(order.id), "code": order.code, "status": order.status,
            "total": str(order.total)}


@public_router.get("/track/{order_id}")
async def track_order(order_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    order = await db.get(Order, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    out = _order_out(order)
    # The live map: while the rider is rolling, ship their latest beacon.
    if order.rider_id and order.status == OrderStatus.OUT_FOR_DELIVERY.value:
        rider = await db.get(Rider, order.rider_id)
        if rider:
            out["rider"] = {
                "name": rider.name,
                "lat": str(rider.last_lat) if rider.last_lat is not None else None,
                "lng": str(rider.last_lng) if rider.last_lng is not None else None,
                "seen": rider.last_seen.isoformat() if rider.last_seen else None,
            }
    return out


# hotel-side rider management + assignment endpoints (defined in rider_router)
build_management_endpoints(router, require)
