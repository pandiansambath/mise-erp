"""The rider door (Ph2b) — phone + PIN login, the two-leg delivery flow, and
the GPS beacon that powers everyone's live maps.

`rider_router` — the rider's own endpoints (rider JWT, role=RIDER).
Management endpoints live on the hotel's /ordering router (orders:write).
"""
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.hotels.models import Hotel
from app.ordering.models import Order, OrderStatus
from app.ordering.rider_models import Rider

rider_router = APIRouter(prefix="/rider", tags=["rider"])


async def get_current_rider(
    authorization: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
) -> Rider:
    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload or payload.get("role") != "RIDER":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Rider sign-in required")
    rider = await db.get(Rider, uuid.UUID(str(payload.get("sub"))))
    if rider is None or not rider.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Rider sign-in required")
    return rider


class RiderLogin(BaseModel):
    phone: str = Field(min_length=5, max_length=30)
    pin: str = Field(min_length=4, max_length=8)


@rider_router.post("/login")
async def rider_login(payload: RiderLogin, db: AsyncSession = Depends(get_db)) -> dict:
    rider = (
        await db.execute(
            select(Rider).where(Rider.phone == payload.phone.strip(), Rider.is_active.is_(True))
        )
    ).scalar_one_or_none()
    if rider is None or not verify_password(payload.pin, rider.pin_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong phone or PIN")
    hotel = await db.get(Hotel, rider.hotel_id)
    token = create_access_token(subject=str(rider.id), role="RIDER")
    return {
        "access_token": token,
        "rider": {"id": str(rider.id), "name": rider.name, "online": rider.online},
        "hotel": {"name": hotel.name if hotel else "", "city": hotel.city if hotel else None},
    }


def _leg_out(o: Order) -> dict:
    return {
        "id": str(o.id), "code": o.code, "status": o.status,
        "customer_name": o.customer_name, "phone": o.phone,
        "address_text": o.address_text,
        "address_lat": str(o.address_lat) if o.address_lat is not None else None,
        "address_lng": str(o.address_lng) if o.address_lng is not None else None,
        "note": o.note, "total": str(o.total),
        "items": [{"name": i.name, "quantity": i.quantity} for i in o.items],
    }


@rider_router.get("/me")
async def rider_me(
    rider: Rider = Depends(get_current_rider), db: AsyncSession = Depends(get_db)
) -> dict:
    """Profile + the active job (READY = go pick up · OUT_FOR_DELIVERY = go deliver)."""
    active = (
        await db.execute(
            select(Order)
            .where(
                Order.rider_id == rider.id,
                Order.status.in_([OrderStatus.READY.value, OrderStatus.OUT_FOR_DELIVERY.value]),
            )
            .order_by(Order.created_at)
        )
    ).scalars().first()
    hotel = await db.get(Hotel, rider.hotel_id)
    done_today = (
        await db.execute(
            select(Order).where(
                Order.rider_id == rider.id,
                Order.status == OrderStatus.COMPLETED.value,
            )
        )
    ).scalars().all()
    return {
        "rider": {"id": str(rider.id), "name": rider.name, "online": rider.online},
        "hotel": {"name": hotel.name if hotel else "", "city": hotel.city if hotel else None},
        "active": _leg_out(active) if active else None,
        "delivered_total": len(done_today),
    }


class OnlineBody(BaseModel):
    online: bool


@rider_router.post("/online")
async def rider_online(
    payload: OnlineBody,
    rider: Rider = Depends(get_current_rider),
    db: AsyncSession = Depends(get_db),
) -> dict:
    rider.online = payload.online
    await db.commit()
    return {"online": rider.online}


class LocationBody(BaseModel):
    lat: Decimal
    lng: Decimal


@rider_router.post("/location")
async def rider_location(
    payload: LocationBody,
    rider: Rider = Depends(get_current_rider),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """The beacon: every few seconds while on a job. One row update, no history
    table — the live map only ever needs the LATEST point."""
    rider.last_lat = payload.lat
    rider.last_lng = payload.lng
    rider.last_seen = datetime.now(UTC)
    await db.commit()
    return {"ok": True}


@rider_router.post("/orders/{order_id}/pickup")
async def rider_pickup(
    order_id: uuid.UUID,
    rider: Rider = Depends(get_current_rider),
    db: AsyncSession = Depends(get_db),
) -> dict:
    order = (
        await db.execute(
            select(Order).where(Order.id == order_id, Order.rider_id == rider.id)
        )
    ).scalar_one_or_none()
    if order is None or order.status != OrderStatus.READY.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "This order isn't awaiting pickup")
    order.status = OrderStatus.OUT_FOR_DELIVERY.value
    await db.commit()
    return _leg_out(order)


@rider_router.post("/orders/{order_id}/deliver")
async def rider_deliver(
    order_id: uuid.UUID,
    rider: Rider = Depends(get_current_rider),
    db: AsyncSession = Depends(get_db),
) -> dict:
    order = (
        await db.execute(
            select(Order).where(Order.id == order_id, Order.rider_id == rider.id)
        )
    ).scalar_one_or_none()
    if order is None or order.status != OrderStatus.OUT_FOR_DELIVERY.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "This order isn't out with you")
    order.status = OrderStatus.COMPLETED.value
    await db.commit()
    # the delivered order books itself into the money engine, same as the board
    from app.ordering.router import _record_sale

    await _record_sale(db, order)
    return _leg_out(order)


# ── hotel-side rider management + assignment (mounted on /ordering) ──────────
def build_management_endpoints(router, require):  # noqa: ANN001 — FastAPI plumbing
    class RiderIn(BaseModel):
        name: str = Field(min_length=2, max_length=120)
        phone: str = Field(min_length=5, max_length=30)
        pin: str = Field(min_length=4, max_length=8)

    class RiderPatch(BaseModel):
        is_active: bool | None = None
        pin: str | None = Field(default=None, min_length=4, max_length=8)

    def _rider_out(r: Rider) -> dict:
        return {
            "id": str(r.id), "name": r.name, "phone": r.phone,
            "is_active": r.is_active, "online": r.online,
            "last_seen": r.last_seen.isoformat() if r.last_seen else None,
        }

    @router.get("/riders")
    async def list_riders(
        db: AsyncSession = Depends(get_db), user=Depends(require("orders:read"))
    ) -> list[dict]:
        rows = (
            await db.execute(
                select(Rider).where(Rider.hotel_id == user.hotel_id).order_by(Rider.created_at)
            )
        ).scalars().all()
        return [_rider_out(r) for r in rows]

    @router.post("/riders", status_code=status.HTTP_201_CREATED)
    async def create_rider(
        payload: RiderIn,
        db: AsyncSession = Depends(get_db),
        user=Depends(require("orders:write")),
    ) -> dict:
        dup = (
            await db.execute(select(Rider).where(Rider.phone == payload.phone.strip()))
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status.HTTP_409_CONFLICT, "That phone already has a rider login")
        rider = Rider(
            hotel_id=user.hotel_id, name=payload.name.strip(),
            phone=payload.phone.strip(), pin_hash=hash_password(payload.pin),
        )
        db.add(rider)
        await db.commit()
        await db.refresh(rider)
        return _rider_out(rider)

    @router.patch("/riders/{rider_id}")
    async def update_rider(
        rider_id: uuid.UUID,
        payload: RiderPatch,
        db: AsyncSession = Depends(get_db),
        user=Depends(require("orders:write")),
    ) -> dict:
        rider = (
            await db.execute(
                select(Rider).where(Rider.id == rider_id, Rider.hotel_id == user.hotel_id)
            )
        ).scalar_one_or_none()
        if rider is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider not found")
        if payload.is_active is not None:
            rider.is_active = payload.is_active
            if not payload.is_active:
                rider.online = False
        if payload.pin:
            rider.pin_hash = hash_password(payload.pin)
        await db.commit()
        return _rider_out(rider)

    class AssignBody(BaseModel):
        rider_id: uuid.UUID

    @router.post("/orders/{order_id}/assign")
    async def assign_rider(
        order_id: uuid.UUID,
        payload: AssignBody,
        db: AsyncSession = Depends(get_db),
        user=Depends(require("orders:write")),
    ) -> dict:
        order = (
            await db.execute(
                select(Order).where(Order.id == order_id, Order.hotel_id == user.hotel_id)
            )
        ).scalar_one_or_none()
        rider = (
            await db.execute(
                select(Rider).where(
                    Rider.id == payload.rider_id, Rider.hotel_id == user.hotel_id,
                    Rider.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if order is None or rider is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Order or rider not found")
        if order.fulfilment != "DELIVERY":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pickup orders need no rider")
        order.rider_id = rider.id
        await db.commit()
        return {"ok": True, "rider_name": rider.name}
