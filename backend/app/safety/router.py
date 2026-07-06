"""Food-safety endpoints: temperature readings + daily checks. Hotel-scoped."""
from datetime import date as date_type

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require, require_feature
from app.auth.models import User
from app.core import notify
from app.core.database import get_db
from app.hotels.models import Hotel
from app.safety import pdf as safety_pdf
from app.safety import service
from app.safety.schemas import SafetyLogCreate, SafetyLogOut

router = APIRouter(
    prefix="/safety", tags=["safety"],
    dependencies=[Depends(require_feature("food_safety"))],
)


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
        text = (
            f"{payload.label} read {payload.reading}°C, outside the safe range. "
            f"Logged by {user.email}. Please check the appliance."
        )
        await notify.email_hotel_admins(
            db,
            user.hotel_id,
            f"⚠ Temperature alert — {payload.label}",
            text,
            html=notify.render_email(
                heading="⚠ Temperature out of range",
                intro=(
                    "A food-safety temperature reading just failed its safe range. "
                    "Please check the appliance and take corrective action."
                ),
                rows=[
                    ("Appliance", payload.label),
                    ("Reading", f"{payload.reading}°C"),
                    ("Logged by", user.email),
                ],
                cta_label="Open Food Safety",
                cta_url="http://18.133.95.137/food-safety",
                accent="#e11d48",
            ),
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


@router.get("/logs.pdf")
async def export_logs_pdf(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    """The food-safety log as a clean, branded PDF (server-side, not a screen-print)."""
    hotel = await db.get(Hotel, user.hotel_id)
    logs = await service.list_logs(db, user.hotel_id, date_from, date_to)
    data = safety_pdf.safety_log_pdf(
        hotel.name if hotel else "Mise", date_from or "", date_to or "", logs
    )
    return Response(
        content=data, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="food-safety-log.pdf"'},
    )
