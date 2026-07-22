"""Audit service: record an event (best-effort, never breaks the main action) + list."""
import uuid

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditEvent


async def record(
    db: AsyncSession,
    *,
    hotel_id: uuid.UUID,
    user,
    action: str,
    summary: str,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
) -> AuditEvent | None:
    """Append an audit event. Best-effort: the core action has already committed,
    so a logging failure must not surface to the user."""
    ev = AuditEvent(
        hotel_id=hotel_id,
        user_id=getattr(user, "id", None),
        user_email=getattr(user, "email", "") or "",
        action=action,
        summary=summary[:300],
        entity_type=entity_type,
        entity_id=entity_id,
    )
    try:
        db.add(ev)
        await db.commit()
        return ev
    except Exception:
        await db.rollback()
        return None


async def list_events(db: AsyncSession, hotel_id: uuid.UUID, limit: int = 150) -> list[AuditEvent]:
    rows = await db.execute(
        select(AuditEvent)
        .where(AuditEvent.hotel_id == hotel_id)
        .order_by(desc(AuditEvent.created_at))
        .limit(limit)
    )
    return list(rows.scalars().all())


async def list_for_entity(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    entity_type: str,
    entity_id: uuid.UUID,
    limit: int = 100,
) -> list[AuditEvent]:
    """Audit trail for ONE entity (e.g. an employee) — newest first."""
    rows = await db.execute(
        select(AuditEvent)
        .where(
            AuditEvent.hotel_id == hotel_id,
            AuditEvent.entity_type == entity_type,
            AuditEvent.entity_id == entity_id,
        )
        .order_by(desc(AuditEvent.created_at))
        .limit(limit)
    )
    return list(rows.scalars().all())
