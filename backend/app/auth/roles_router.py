"""Custom roles — job titles a hotel invents, bounded by an archetype.

The owner names the role ("Kitchen Manager", "Accounts Assistant") and picks
which base archetype it behaves like. They may then toggle individual
permissions, but only ones inside that archetype's envelope — the endpoint
returns exactly that list, so the UI can never offer an unsafe grant, and the
server clips anything that arrives anyway.

Two independent gates still apply on top: the hotel's PLAN decides whether a
feature exists at all, and this role decides whether the person may use it.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import CustomRole, Role, User
from app.core.database import get_db
from app.core.rbac import PERMISSIONS, envelope_for, resolve_permissions

router = APIRouter(prefix="/roles", tags=["roles"])

# Owner is excluded on purpose: it has no ceiling, so a custom role based on it
# would just be a second owner. If you want another owner, make them one.
ASSIGNABLE = [r.value for r in Role if r is not Role.SUPER_ADMIN]

_LABELS = {
    Role.MANAGER.value: "Manager — runs the venue day to day",
    Role.KITCHEN_MANAGER.value: "Chef / kitchen — food, stock and recipes",
    Role.ACCOUNTANT.value: "Accounts — payroll, suppliers and the books",
    Role.CASHIER.value: "Till — sales, cash and orders",
    Role.STAFF.value: "Staff — their own rota, hours and payslips",
}


class RoleIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    base_role: str
    overrides: dict[str, bool] = Field(default_factory=dict)


class RoleOut(BaseModel):
    id: uuid.UUID
    name: str
    base_role: str
    overrides: dict[str, bool]
    permissions: list[str]
    is_active: bool


def _out(cr: CustomRole) -> RoleOut:
    return RoleOut(
        id=cr.id,
        name=cr.name,
        base_role=cr.base_role,
        overrides=cr.overrides or {},
        permissions=resolve_permissions(cr.base_role, cr.overrides or {}),
        is_active=cr.is_active,
    )


@router.get("/archetypes")
async def archetypes(_: User = Depends(require("users:read"))) -> dict:
    """The base roles a custom role can be built on, each with the FULL list of
    permissions it may ever hold. The UI renders a toggle per entry here and
    nothing else — which is why a waiter can never be given the hiring page."""
    return {
        "archetypes": [
            {
                "key": key,
                "label": _LABELS.get(key, key.replace("_", " ").title()),
                "defaults": sorted(PERMISSIONS.get(key, [])),
                "envelope": envelope_for(key),
            }
            for key in ASSIGNABLE
        ]
    }


@router.get("")
async def list_roles(
    db: AsyncSession = Depends(get_db), user: User = Depends(require("users:read"))
) -> dict:
    rows = (
        (
            await db.execute(
                select(CustomRole)
                .where(CustomRole.hotel_id == user.hotel_id)
                .order_by(CustomRole.name)
            )
        )
        .scalars()
        .all()
    )
    return {"roles": [_out(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_role(
    payload: RoleIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> RoleOut:
    if payload.base_role not in ASSIGNABLE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown base role")
    cr = CustomRole(
        hotel_id=user.hotel_id,
        name=payload.name.strip(),
        base_role=payload.base_role,
        overrides=_clip(payload.base_role, payload.overrides),
    )
    db.add(cr)
    await db.commit()
    await db.refresh(cr)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="role.create",
        summary=f"Created the role '{cr.name}' based on {cr.base_role}",
        entity_type="role", entity_id=cr.id,
    )
    return _out(cr)


@router.patch("/{role_id}")
async def update_role(
    role_id: uuid.UUID,
    payload: RoleIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> RoleOut:
    cr = await db.get(CustomRole, role_id)
    if cr is None or cr.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    if payload.base_role not in ASSIGNABLE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown base role")
    cr.name = payload.name.strip()
    cr.base_role = payload.base_role
    cr.overrides = _clip(payload.base_role, payload.overrides)
    await db.commit()
    await db.refresh(cr)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="role.update",
        summary=f"Updated the role '{cr.name}'",
        entity_type="role", entity_id=cr.id,
    )
    return _out(cr)


@router.delete("/{role_id}")
async def deactivate_role(
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> dict:
    """Deactivate rather than delete. Anyone holding it falls back to their base
    archetype, which is narrower — losing a role must never widen access."""
    cr = await db.get(CustomRole, role_id)
    if cr is None or cr.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    cr.is_active = False
    await db.commit()
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="role.remove",
        summary=f"Deactivated the role '{cr.name}'",
        entity_type="role", entity_id=cr.id,
    )
    return {"ok": True}


def _clip(base_role: str, overrides: dict[str, bool]) -> dict[str, bool]:
    """Keep only permissions inside the archetype's envelope.

    The UI already hides the rest, so anything else arriving here is either a
    stale client or someone poking the API directly. Either way it is dropped
    silently rather than 400'd — a caller must not be able to probe the ceiling
    by watching which grants are rejected.
    """
    allowed = set(envelope_for(base_role))
    return {k: bool(v) for k, v in overrides.items() if k in allowed}
