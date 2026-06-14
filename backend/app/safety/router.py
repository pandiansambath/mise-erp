"""Food-safety endpoints: temperature readings + daily checks. Hotel-scoped."""
from datetime import date as date_type

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core import notify
from app.core.database import get_db
from app.safety import service
from app.safety.schemas import SafetyLogCreate, SafetyLogOut

router = APIRouter(prefix="/safety", tags=["safety"])


@router.post("/logs", response_model=SafetyLogOut, status_code=status.HTTP_201_CREATED)
async def create_log(
    payload: SafetyLogCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> SafetyLogOut:
    log = await service.create_log(
        db,
        user.hotel_id,
        kind=payload.kind,
        label=payload.label,
        status=payload.status,
        reading=payload.reading,
        notes=payload.notes,
        on=payload.date,
        logged_by=user.id,
    )
    # Alert owners/managers on an out-of-range temperature (no-ops without a provider key).
    if payload.kind == "TEMP" and payload.status == "FAIL":
        await notify.email_hotel_admins(
            db,
            user.hotel_id,
            f"⚠ Temperature alert — {payload.label}",
            f"{payload.label} read {payload.reading}°C, outside the safe range. "
            f"Logged by {user.email}. Please check the appliance.",
        )
    return SafetyLogOut.model_validate(log)


@router.get("/logs", response_model=list[SafetyLogOut])
async def list_logs(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[SafetyLogOut]:
    logs = await service.list_logs(db, user.hotel_id, date_from, date_to)
    return [SafetyLogOut.model_validate(x) for x in logs]
