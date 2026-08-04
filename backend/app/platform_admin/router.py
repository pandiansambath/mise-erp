"""Platform operator (Control Room) API — cross-tenant management of ALL hotels.

Strictly gated to users with ``is_platform_owner`` (the DineAI operator, i.e. us).
A normal hotel Super Admin CANNOT reach any of this. Capabilities:
  • list every hotel with quick stats,
  • toggle per-hotel FEATURES (entitlements) — foundation for plan tiers,
  • reset the password of any user in any hotel.
"""
import logging
import uuid
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit_service
from app.audit.models import AuditEvent
from app.auth import service as auth_service
from app.auth.deps import get_current_user
from app.auth.models import Role, User
from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.hotels.models import Hotel
from app.platform_admin import deletion
from app.platform_admin import features as feat
from app.platform_admin.models import PlatformAnnouncement, PlatformConfig


async def _plan_price_overrides(db: AsyncSession) -> dict:
    row = await db.get(PlatformConfig, 1)
    return dict(row.plan_prices) if row and row.plan_prices else {}

log = logging.getLogger("mise.platform")

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
    """Every hotel with quick stats + resolved feature entitlements + health."""
    hotels = list((await db.execute(select(Hotel).order_by(Hotel.created_at))).scalars().all())
    users = list((await db.execute(select(User).order_by(User.created_at))).scalars().all())

    by_hotel: dict[uuid.UUID, list[User]] = defaultdict(list)
    for u in users:
        by_hotel[u.hotel_id].append(u)

    # Health signals: latest login per hotel + sales entries in the last 7 days.
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import func as safunc

    from app.sales.models import DailySales

    week_ago = (datetime.now(UTC) - timedelta(days=7)).date()
    sales_rows = await db.execute(
        select(DailySales.hotel_id, safunc.count())
        .where(DailySales.date >= week_ago)
        .group_by(DailySales.hotel_id)
    )
    sales_7d = {hid: n for hid, n in sales_rows.all()}
    # funnel signal: has this hotel EVER recorded a sale?
    traded_rows = await db.execute(select(DailySales.hotel_id).distinct())
    has_traded = {hid for (hid,) in traded_rows.all()}

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
            # The @handle. Deleting a hotel requires typing this exactly, so it
            # has to reach the client or the confirmation can never match.
            "handle": h.username,
            "user_count": len(hu),
            "admin_email": admin.email if admin else None,
            "plan": h.plan,
            "max_users": feat.plan_max_users(h.plan),
            # Operator overrides, so the Control Room can show their real state
            # rather than defaulting the checkbox to off on every reload.
            "is_comp": bool(getattr(h, "is_comp", False)),
            "ai_daily_override": getattr(h, "ai_daily_override", None),
            "ai_monthly_override": getattr(h, "ai_monthly_override", None),
            "features": _merged_features(h),
            "has_traded": h.id in has_traded,
            "last_active": max(
                (u.last_login for u in hu if u.last_login), default=None
            ).isoformat() if any(u.last_login for u in hu) else None,
            "sales_entries_7d": sales_7d.get(h.id, 0),
        })
    return {"hotels": items}


@router.get("/plans")
async def list_plans(db: AsyncSession = Depends(get_db)) -> dict:
    """Subscription plans (features + limits + current prices). PUBLIC so the landing
    page can render live pricing; contains no sensitive data."""
    return {"plans": feat.plans_public(await _plan_price_overrides(db))}


class PlanPrices(BaseModel):
    prices: dict[str, str] = Field(default_factory=dict)  # plan_key -> "£89/mo"


class OperatorAsk(BaseModel):
    question: str = Field(min_length=2, max_length=2000)


@router.post("/ai/ask")
async def operator_ai(
    body: OperatorAsk,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_platform_owner),
) -> dict:
    """The one assistant that sees across hotels — plans, billing state and AI
    spend, never a tenant's own recipes, prices or staff."""
    from app.assistant.bedrock import BedrockUnavailable
    from app.platform_admin import ai as operator_brain

    try:
        return {"reply": await operator_brain.ask(db, user, body.question)}
    except BedrockUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None


class HotelFlagsIn(BaseModel):
    is_comp: bool | None = None
    ai_daily_override: int | None = None
    ai_monthly_override: int | None = None


@router.patch("/hotels/{hotel_id}/flags")
async def set_hotel_flags(
    hotel_id: uuid.UUID,
    body: HotelFlagsIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_platform_owner),
) -> dict:
    """Operator switches: comp an account, or lift one hotel's AI allowance.

    `is_comp` is how internal and demo hotels get full access without being
    billed — and, critically, without counting toward revenue. The AI overrides
    let one hotel be raised above its plan (a pilot, a goodwill gesture) without
    inventing a plan for them.
    """
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    if body.is_comp is not None:
        hotel.is_comp = body.is_comp
    if body.ai_daily_override is not None:
        hotel.ai_daily_override = body.ai_daily_override or None
    if body.ai_monthly_override is not None:
        hotel.ai_monthly_override = body.ai_monthly_override or None
    await db.commit()
    return {
        "is_comp": hotel.is_comp,
        "ai_daily_override": hotel.ai_daily_override,
        "ai_monthly_override": hotel.ai_monthly_override,
    }


@router.get("/plans/matrix")
async def plans_matrix() -> dict:
    """Every feature × every plan. PUBLIC, and deliberately the same registry the
    app enforces from — a pricing table built from separate copy drifts, and then
    you're selling something you don't ship."""
    return {"features": feat.plan_matrix(), "plans": feat.plans_public()}


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
    # Besides the in-app banner, email each hotel's admins who opted in.
    from app.core import notify

    hotel_ids = (
        (await db.execute(select(Hotel.id).where(Hotel.is_active.is_(True)))).scalars().all()
    )
    for hid in hotel_ids:
        await notify.email_hotel_admins(
            db,
            hid,
            f"DineAI announcement: {body.message.strip()[:80]}",
            body.message.strip(),
            html=notify.render_email(
                badge="📣 Announcement",
                heading="A note from DineAI HQ",
                intro=body.message.strip(),
                accent="#0ea5e9" if body.level == "info" else "#d97742",
            ),
            pref_key="broadcast",
            background=True,
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


@router.post("/hotels/{hotel_id}/impersonate")
async def impersonate_hotel(
    hotel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Read-only support view: a 15-minute token for the hotel's admin carrying
    the `imp` claim — every write endpoint refuses it server-side. Audited."""
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")
    admin = (await db.execute(
        select(User)
        .where(User.hotel_id == hotel_id, User.role == Role.SUPER_ADMIN.value)
        .order_by(User.created_at)
    )).scalars().first()
    if admin is None:
        raise HTTPException(status_code=404, detail="Hotel has no admin user")
    token = create_access_token(str(admin.id), admin.role, expires_minutes=15, impersonated=True)
    await audit_service.record(
        db, hotel_id=hotel_id, user=operator, action="platform.impersonate",
        summary=f"Operator opened a 15-min READ-ONLY view as {admin.email}",
        entity_type="user", entity_id=admin.id,
    )
    return {"token": token, "email": admin.email, "expires_minutes": 15}


@router.get("/audit")
async def platform_audit(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_owner),
) -> dict:
    """Every operator action across all hotels (platform.*), newest first."""
    rows = (await db.execute(
        select(AuditEvent)
        .where(AuditEvent.action.like("platform.%"))
        .order_by(AuditEvent.created_at.desc())
        .limit(100)
    )).scalars().all()
    return {"events": [
        {
            "id": str(e.id), "hotel_id": str(e.hotel_id), "user_email": e.user_email,
            "action": e.action, "summary": e.summary,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in rows
    ]}


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


# ── job portal moderation ─────────────────────────────────────────────────────
@router.get("/jobs")
async def platform_jobs(
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Every posting across the fleet, with its hotel and applicant count."""
    from sqlalchemy import func as safunc

    from app.hotels.models import Hotel as HotelModel
    from app.jobs.models import JobApplication, JobPosting

    rows = (
        await db.execute(
            select(JobPosting, HotelModel.name)
            .join(HotelModel, HotelModel.id == JobPosting.hotel_id)
            .order_by(JobPosting.created_at.desc())
        )
    ).all()
    counts = dict(
        (
            await db.execute(
                select(JobApplication.posting_id, safunc.count(JobApplication.id)).group_by(
                    JobApplication.posting_id
                )
            )
        ).all()
    )
    return {
        "postings": [
            {
                "id": str(p.id),
                "hotel_name": name,
                "title": p.title,
                "status": p.status,
                "employment_type": p.employment_type,
                "location": p.location,
                "created_at": p.created_at.isoformat(),
                "applications": int(counts.get(p.id, 0)),
            }
            for p, name in rows
        ]
    }


class PlatformJobPatch(BaseModel):
    status: str  # OPEN | CLOSED


@router.patch("/jobs/{posting_id}")
async def platform_job_status(
    posting_id: uuid.UUID,
    payload: PlatformJobPatch,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    from app.jobs.models import JobPosting, JobStatus

    if payload.status not in (JobStatus.OPEN.value, JobStatus.CLOSED.value):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Status must be OPEN or CLOSED")
    posting = (
        await db.execute(select(JobPosting).where(JobPosting.id == posting_id))
    ).scalar_one_or_none()
    if not posting:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Posting not found")
    posting.status = payload.status
    await db.commit()
    await audit_service.record(
        db, hotel_id=operator.hotel_id, user=operator, action="platform.job_status",
        summary=f"Job '{posting.title}' set {payload.status}",
    )
    return {"id": str(posting.id), "status": posting.status}


@router.delete("/jobs/{posting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def platform_job_delete(
    posting_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> None:
    from app.jobs.models import JobPosting

    posting = (
        await db.execute(select(JobPosting).where(JobPosting.id == posting_id))
    ).scalar_one_or_none()
    if not posting:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Posting not found")
    title = posting.title
    await db.delete(posting)
    await db.commit()
    await audit_service.record(
        db, hotel_id=operator.hotel_id, user=operator, action="platform.job_delete",
        summary=f"Job '{title}' removed from the board",
    )


# ── operator accounts ────────────────────────────────────────────────────────
@router.get("/operators")
async def list_operators(
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    rows = (
        (
            await db.execute(
                select(User).where(User.is_platform_owner.is_(True)).order_by(User.email)
            )
        )
        .scalars()
        .all()
    )
    return {
        "operators": [
            {
                "id": str(u.id),
                "email": u.email,
                "is_active": u.is_active,
                "last_login": u.last_login.isoformat() if u.last_login else None,
                "you": u.id == operator.id,
            }
            for u in rows
        ]
    }


class OperatorIn(BaseModel):
    email: str = Field(min_length=5, max_length=200)
    password: str = Field(min_length=8, max_length=128)


@router.post("/operators", status_code=status.HTTP_201_CREATED)
async def create_operator(
    payload: OperatorIn,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    from app.auth.models import Role
    from app.auth.service import create_user, get_user_by_email

    if await get_user_by_email(db, payload.email.strip().lower()):
        raise HTTPException(status.HTTP_409_CONFLICT, "That email already has an account")
    user = await create_user(
        db, payload.email.strip().lower(), payload.password, Role.SUPER_ADMIN.value,
        operator.hotel_id,
    )
    user.is_platform_owner = True
    await db.commit()
    await audit_service.record(
        db, hotel_id=operator.hotel_id, user=operator, action="platform.operator_add",
        summary=f"Operator account created: {user.email}",
    )
    return {"id": str(user.id), "email": user.email}


class OperatorPatch(BaseModel):
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


@router.patch("/operators/{operator_id}")
async def update_operator(
    operator_id: uuid.UUID,
    payload: OperatorPatch,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    from app.core.security import hash_password

    if operator_id == operator.id and payload.active is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't deactivate yourself")
    target = (
        await db.execute(
            select(User).where(User.id == operator_id, User.is_platform_owner.is_(True))
        )
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operator not found")
    changes: list[str] = []
    if payload.active is not None:
        target.is_active = payload.active
        changes.append("reactivated" if payload.active else "deactivated")
    if payload.password:
        target.password_hash = hash_password(payload.password)
        changes.append("password reset")
    await db.commit()
    await audit_service.record(
        db, hotel_id=operator.hotel_id, user=operator, action="platform.operator_update",
        summary=f"Operator {target.email}: {', '.join(changes) or 'no changes'}",
    )
    return {"id": str(target.id), "is_active": target.is_active}


# ── Permanently deleting a restaurant ───────────────────────────────────────
# The most destructive action in the product. See app/platform_admin/deletion.py
# for why nothing cascades and why the archive is not optional.


@router.get("/hotels/{hotel_id}/deletion-preview")
async def deletion_preview(
    hotel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """What would be destroyed, counted. Reads only."""
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such hotel")
    return {
        "hotel_name": hotel.name,
        "handle": hotel.username,
        **(await deletion.preview(db, hotel_id)),
    }


class HotelDeleteRequest(BaseModel):
    """Typing the handle is the confirmation.

    Not a checkbox: a checkbox is muscle memory, typing a name is a decision.
    """

    confirm_handle: str
    reason: str | None = None


@router.post("/hotels/{hotel_id}/delete", status_code=status.HTTP_200_OK)
async def delete_hotel(
    hotel_id: uuid.UUID,
    payload: HotelDeleteRequest,
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(require_platform_owner),
) -> dict:
    """Archive to S3, then remove every row. Irreversible once the archive ages out.

    POST rather than DELETE on purpose: this needs a body (the typed handle), and
    a bare DELETE is far too easy to fire by accident from a tool or a stray
    click.
    """
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such hotel")

    expected = (hotel.username or str(hotel.id)).strip().lower()
    if payload.confirm_handle.strip().lower() != expected:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That does not match. Type “{expected}” exactly to confirm.",
        )

    # Archive FIRST. If it fails, refuse — an irreversible act must not run on a
    # best-effort backup.
    key = await deletion.archive(db, hotel_id, hotel.username or "")
    if key is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Could not archive this hotel's data to S3, so nothing was deleted. "
            "Deleting without a copy is not allowed.",
        )

    name = hotel.name
    removed = await deletion.purge(db, hotel_id)
    await db.commit()

    log.warning(
        "hotel PERMANENTLY DELETED: %s (%s) by %s — archived to %s",
        name, expected, operator.email, key,
        extra={"code": "DINE-B2009"},
    )
    return {"deleted": True, "hotel_name": name, "archive_key": key, "removed": removed}
