"""Platform operator (Control Room) API — cross-tenant management of ALL hotels.

Strictly gated to users with ``is_platform_owner`` (the Mise operator, i.e. us).
A normal hotel Super Admin CANNOT reach any of this. Capabilities:
  • list every hotel with quick stats,
  • toggle per-hotel FEATURES (entitlements) — foundation for plan tiers,
  • reset the password of any user in any hotel.
"""
import uuid
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit_service
from app.auth import service as auth_service
from app.auth.deps import get_current_user
from app.auth.models import Role, User
from app.core.database import get_db
from app.core.security import hash_password
from app.hotels.models import Hotel
from app.platform_admin import features as feat
from app.platform_admin.models import PlatformAnnouncement, PlatformConfig


async def _plan_price_overrides(db: AsyncSession) -> dict:
    row = await db.get(PlatformConfig, 1)
    return dict(row.plan_prices) if row and row.plan_prices else {}

router = APIRouter(prefix="/platform", tags=["platform"])


async def require_platform_owner(user: User = Depends(get_current_user)) -> User:
    if not user.is_platform_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Platform owner only"
        )
    return user


class FeatureToggle(BaseModel):
    features: dict[str, bool] = Field(default_factory=dict)


class ResetPassword(BaseModel):
    user_id: uuid.UUID | None = None  # defaults to the hotel's primary Super Admin
    new_password: str = Field(min_length=8, max_length=72)  # bcrypt hard limit


class SuspendBody(BaseModel):
    active: bool  # False = suspend (logins blocked), True = reactivate


class AnnouncementCreate(BaseModel):
    message: str = Field(min_length=3, max_length=500)
    level: str = Field(default="info", pattern=r"^(info|warn)$")
    expires_at: datetime | None = None


def _merged_features(hotel: Hotel) -> dict[str, bool]:
    """Every registered feature resolved to on/off for this hotel."""
    return {f.key: hotel.feature_on(f.key) for f in feat.FEATURES}


@router.get("/features")
async def list_features(_: User = Depends(require_platform_owner)) -> dict:
    """The feature registry (labels/descriptions) for the Control Room UI."""
    return {"features": feat.registry_public()}


@router.get("/hotels")
async def list_hotels(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_owner),
) -> dict:
    """Every hotel with quick stats + resolved feature entitlements."""
    hotels = list((await db.execute(select(Hotel).order_by(Hotel.created_at))).scalars().all())
    users = list((await db.execute(select(User).order_by(User.created_at))).scalars().all())

    by_hotel: dict[uuid.UUID, list[User]] = defaultdict(list)
    for u in users:
        by_hotel[u.hotel_id].append(u)

    items = []
    for h in hotels:
        hu = by_hotel.get(h.id, [])
        admin = next((u for u in hu if u.role == Role.SUPER_ADMIN.value), hu[0] if hu else None)
        items.append({
            "id": str(h.id),
            "name": h.name,
            "city": h.city,
            "country": h.country,
            "base_currency": h.base_currency,
            "created_at": h.created_at.isoformat(),
            "has_logo": h.has_logo,
            "is_active": h.is_active,
            "user_count": len(hu),
            "admin_email": admin.email if admin else None,
            "plan": h.plan,
            "max_users": feat.plan_max_users(h.plan),
            "features": _merged_features(h),
        })
    return {"hotels": items}


@router.get("/plans")
async def list_plans(db: AsyncSession = Depends(get_db)) -> dict:
    """Subscription plans (features + limits + current prices). PUBLIC so the landing
    page can render live pricing; contains no sensitive data."""
    return {"plans": feat.plans_public(await _plan_price_overrides(db))}


class PlanPrices(BaseModel):
    prices: dict[str, str] = Field(default_factory=dict)  # plan_key -> "£89/mo"


@router.patch("/plans/prices")
async def set_plan_prices(
    body: PlanPrices,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Operator edits the displayed price of each plan (Control Room)."""
    clean = {k: v.strip() for k, v in body.prices.items() if feat.is_valid_plan(k) and v.strip()}
    row = await db.get(PlatformConfig, 1)
    if row is None:
        row = PlatformConfig(id=1, plan_prices=clean)
        db.add(row)
    else:
        row.plan_prices = clean
    await db.commit()
    await audit_service.record(
        db, hotel_id=operator.hotel_id, user=operator, action="platform.plan_prices",
        summary=f"Plan prices updated: {clean}"[:300],
    )
    return {"plans": feat.plans_public(clean)}


class AssignPlan(BaseModel):
    plan: str


@router.post("/hotels/{hotel_id}/plan")
async def assign_plan(
    hotel_id: uuid.UUID,
    body: AssignPlan,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Put a hotel on a plan — sets its plan + APPLIES that plan's feature preset
    (the operator can still fine-tune individual toggles afterwards)."""
    if not feat.is_valid_plan(body.plan):
        raise HTTPException(status_code=400, detail=f"Unknown plan '{body.plan}'")
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")
    hotel.plan = body.plan
    hotel.features = feat.plan_features(body.plan)  # preset (reassign so JSON is dirty)
    await db.commit()
    await audit_service.record(
        db, hotel_id=hotel_id, user=operator, action="platform.plan",
        summary=f"Plan set to {body.plan}", entity_type="hotel", entity_id=hotel_id,
    )
    return {"plan": hotel.plan, "features": _merged_features(hotel)}


@router.get("/hotels/{hotel_id}/users")
async def hotel_users(
    hotel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_owner),
) -> dict:
    """Users of one hotel — so the operator can pick whose password to reset."""
    us = await auth_service.list_users(db, hotel_id)
    return {"users": [
        {"id": str(u.id), "email": u.email, "role": u.role, "is_active": u.is_active}
        for u in us
    ]}


@router.patch("/hotels/{hotel_id}/features")
async def set_features(
    hotel_id: uuid.UUID,
    body: FeatureToggle,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Turn features on/off for a hotel. Unknown keys are rejected."""
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")
    current = dict(hotel.features or {})
    for key, val in body.features.items():
        if not feat.is_valid_feature(key):
            raise HTTPException(status_code=400, detail=f"Unknown feature '{key}'")
        current[key] = bool(val)
    hotel.features = current  # reassign so SQLAlchemy flags the JSON column dirty
    await db.commit()
    changed = ", ".join(f"{k}={'on' if v else 'off'}" for k, v in body.features.items())
    await audit_service.record(
        db, hotel_id=hotel_id, user=operator, action="platform.features",
        summary=f"Features changed: {changed}"[:300], entity_type="hotel", entity_id=hotel_id,
    )
    return {"features": _merged_features(hotel)}


@router.post("/hotels/{hotel_id}/reset-password")
async def reset_password(
    hotel_id: uuid.UUID,
    body: ResetPassword,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Reset a user's password (defaults to the hotel's primary Super Admin)."""
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")

    if body.user_id is not None:
        target = await db.get(User, body.user_id)
    else:
        target = (await db.execute(
            select(User)
            .where(User.hotel_id == hotel_id, User.role == Role.SUPER_ADMIN.value)
            .order_by(User.created_at)
        )).scalars().first()

    if target is None or target.hotel_id != hotel_id:
        raise HTTPException(status_code=404, detail="User not found in this hotel")

    target.password_hash = hash_password(body.new_password)
    await db.commit()
    await audit_service.record(
        db, hotel_id=hotel_id, user=operator, action="platform.reset_password",
        summary=f"Password reset for {target.email}", entity_type="user", entity_id=target.id,
    )
    return {"ok": True, "email": target.email}


def _announcement_out(a: PlatformAnnouncement) -> dict:
    return {
        "id": str(a.id),
        "message": a.message,
        "level": a.level,
        "expires_at": a.expires_at.isoformat() if a.expires_at else None,
        "is_active": a.is_active,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.get("/announcements")
async def list_announcements(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_owner),
) -> dict:
    """Every broadcast, newest first — the operator's send history."""
    rows = (await db.execute(
        select(PlatformAnnouncement).order_by(PlatformAnnouncement.created_at.desc()).limit(50)
    )).scalars().all()
    return {"announcements": [_announcement_out(a) for a in rows]}


@router.post("/announcements")
async def create_announcement(
    body: AnnouncementCreate,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Broadcast a banner to every hotel's app shell (until expiry/deactivation)."""
    a = PlatformAnnouncement(
        message=body.message.strip(), level=body.level, expires_at=body.expires_at
    )
    db.add(a)
    await db.commit()
    await audit_service.record(
        db, hotel_id=operator.hotel_id, user=operator, action="platform.announce",
        summary=f"Broadcast ({body.level}): {body.message[:120]}", entity_type="platform",
    )
    return _announcement_out(a)


@router.delete("/announcements/{announcement_id}")
async def deactivate_announcement(
    announcement_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    a = await db.get(PlatformAnnouncement, announcement_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Announcement not found")
    a.is_active = False
    await db.commit()
    await audit_service.record(
        db, hotel_id=operator.hotel_id, user=operator, action="platform.announce_off",
        summary=f"Broadcast withdrawn: {a.message[:120]}", entity_type="platform",
    )
    return {"ok": True}


@router.get("/announcements/active")
async def active_announcements(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),  # ANY signed-in user — feeds the app-shell banner
) -> dict:
    now = datetime.now(UTC)
    rows = (await db.execute(
        select(PlatformAnnouncement)
        .where(PlatformAnnouncement.is_active.is_(True))
        .order_by(PlatformAnnouncement.created_at.desc())
        .limit(5)
    )).scalars().all()
    live = [a for a in rows if a.expires_at is None or a.expires_at > now]
    return {"announcements": [_announcement_out(a) for a in live]}


@router.post("/hotels/{hotel_id}/suspend")
async def suspend_hotel(
    hotel_id: uuid.UUID,
    body: SuspendBody,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Suspend (block all logins) or reactivate a hotel. Data is untouched —
    people just can't sign in while suspended."""
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")
    hotel.is_active = body.active
    await db.commit()
    await audit_service.record(
        db, hotel_id=hotel_id, user=operator,
        action="platform.suspend" if not body.active else "platform.reactivate",
        summary=f"Hotel {'reactivated' if body.active else 'SUSPENDED'}: {hotel.name}",
        entity_type="hotel", entity_id=hotel_id,
    )
    return {"is_active": hotel.is_active}
