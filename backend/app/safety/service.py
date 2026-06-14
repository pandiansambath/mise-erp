"""Food-safety service: record a check/reading + list by date range."""
import uuid
from datetime import date as date_type

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.safety.models import SafetyLog


async def create_log(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    kind: str,
    label: str,
    status: str,
    reading=None,
    notes: str | None = None,
    on: date_type | None = None,
    logged_by: uuid.UUID | None = None,
) -> SafetyLog:
    log = SafetyLog(
        hotel_id=hotel_id,
        date=on or date_type.today(),
        kind=kind,
        label=label,
        reading=reading,
        status=status,
        notes=notes,
        logged_by=logged_by,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log


async def list_logs(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    limit: int = 300,
) -> list[SafetyLog]:
    stmt = select(SafetyLog).where(SafetyLog.hotel_id == hotel_id)
    if date_from is not None:
        stmt = stmt.where(SafetyLog.date >= date_from)
    if date_to is not None:
        stmt = stmt.where(SafetyLog.date <= date_to)
    stmt = stmt.order_by(desc(SafetyLog.created_at)).limit(limit)
    return list((await db.execute(stmt)).scalars().all())
