"""Audit endpoint: recent money-trust events. Manager/owner only. Hotel-scoped."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service
from app.audit.schemas import AuditEventOut
from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditEventOut])
async def list_audit(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:read")),  # managers + owners
) -> list[AuditEventOut]:
    rows = await service.list_events(db, user.hotel_id)
    return [AuditEventOut.model_validate(r) for r in rows]
