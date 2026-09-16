"""Audit endpoint: recent money-trust events. Manager/owner only. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service
from app.audit.schemas import AuditEventOut
from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditEventOut])
async def list_audit(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=150, le=1000),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:read")),  # managers + owners
) -> list[AuditEventOut]:
    """The whole log, or one thing's own history.

    `entity_type` + `entity_id` answer "what happened to THIS" — which is the
    question somebody actually has when they are looking at a renamed table and
    wondering what it used to be called. Without them the only way to find that
    was to read the whole feed and hope.

    ⚠️ `response_model` SILENTLY DROPS anything not declared on `AuditEventOut`.
    Adding a field to the event and forgetting the schema is a trap this project
    has hit nine times, so anything new here must be declared there too.
    """
    rows = await service.list_events(
        db,
        user.hotel_id,
        limit=limit,
        date_from=date_from,
        date_to=date_to,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    return [AuditEventOut.model_validate(r) for r in rows]
