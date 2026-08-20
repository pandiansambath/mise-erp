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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import CustomRole, Role, RoleDefault, User
from app.core.database import get_db
from app.core.rbac import (
    ENVELOPES,
    PERMISSIONS,
    envelope_for,
    grantable_for,
    resolve_permissions,
)

# Every permission the app knows about. The owner is entitled to see the whole
# board — the envelope becomes a hint, not a fence.
ALL_PERMISSIONS = sorted(
    {p for perms in PERMISSIONS.values() for p in perms if p != "*"}
    | {p for perms in ENVELOPES.values() for p in perms if p != "*"}
)

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
    """Keep anything the app actually knows how to grant.

    This used to keep only what was inside the archetype's envelope, which made
    the envelope a ceiling rather than a default — "for manager we have only
    expense can change / can see option... we need literally all the pages with
    read and write that super admin can choose to give."

    So the filter is now "is this a real permission", not "is this typical for
    the job". Unknown strings are still dropped silently rather than 400'd: a
    caller must not be able to map the app by watching which grants stick. The
    KIOSK keeps its seal — see `grantable_for`.
    """
    allowed = set(grantable_for(base_role))
    return {k: bool(v) for k, v in overrides.items() if k in allowed}


class AccessIn(BaseModel):
    """What one PERSON may reach. Not a role — a person."""

    #: Their job, which sets the ceiling. Omitted = leave their job alone.
    base_role: str | None = None
    #: Permission -> on/off, relative to that job's defaults.
    overrides: dict[str, bool] = Field(default_factory=dict)


@router.put("/user/{user_id}/access")
async def set_user_access(
    user_id: uuid.UUID,
    payload: AccessIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> dict:
    """Set what ONE person can reach, in a single call.

    The old shape asked an owner to think like an administrator: pick an
    archetype, toggle inside its envelope, name and save a ROLE, then go
    somewhere else and ATTACH it. Four concepts to answer one question — and
    the proof it did not work is that the only role this hotel ever designed
    was attached to nobody.

        "creating role for role like manager and assigning to role like manager
         or staff, it's confusing the laymans. We definitely do something
         simpler for them to easily do whatever they want."

    So: open a person, change what they can reach, done. The custom role still
    exists underneath — it is how the permissions are stored and resolved — but
    it is created, named and attached here rather than being four errands. A
    role built this way belongs to that person; naming one for reuse stays
    available and stays optional.

    The archetype ceiling is untouched: `resolve_permissions` still discards
    anything outside the envelope, so this endpoint cannot grant a waiter the
    payroll however it is called.
    """
    target = await db.get(User, user_id)
    if target is None or target.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    if target.role == Role.SUPER_ADMIN.value:
        # The owner has no ceiling, so there is nothing here to edit — and a
        # half-applied envelope would be a way to lock the owner out of their
        # own hotel.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The owner can already do everything — there is nothing to change.",
        )

    base = payload.base_role or target.role
    if base not in ASSIGNABLE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a job we can bound.")

    # Their job may change as part of the same action; the ceiling follows it.
    if payload.base_role and payload.base_role != target.role:
        target.role = payload.base_role

    # The same for ONE person: "even though if we give manager role to someone,
    # super admin can edit permission for that particular user alone."
    allowed = set(grantable_for(base))
    overrides = {p: v for p, v in payload.overrides.items() if p in allowed}
    defaults = set(PERMISSIONS.get(base, []))
    # Only store what actually DIFFERS from the job's defaults, so "this person
    # is a plain Manager" stays visibly plain instead of accumulating a hundred
    # redundant switches that later read as deliberate choices.
    overrides = {p: v for p, v in overrides.items() if v != (p in defaults)}

    cr: CustomRole | None = None
    if target.custom_role_id:
        cr = await db.get(CustomRole, target.custom_role_id)
        if cr is not None and cr.hotel_id != user.hotel_id:
            cr = None

    if not overrides:
        # Back to exactly their job. Detach rather than keep an empty role
        # around pretending to be a decision.
        target.custom_role_id = None
    else:
        who = target.preferred_name or target.email.split("@")[0]
        if cr is None:
            cr = CustomRole(
                hotel_id=user.hotel_id,
                name=f"{who} — custom access"[:60],
                base_role=base,
                overrides=overrides,
            )
            db.add(cr)
            await db.flush()
        else:
            cr.base_role = base
            cr.overrides = overrides
            cr.is_active = True
        target.custom_role_id = cr.id

    await audit.record(
        db,
        hotel_id=user.hotel_id,
        user=user,
        action="user.access",
        summary=f"Set what {target.preferred_name or target.email} can reach",
        entity_type="user",
        entity_id=target.id,
    )
    await db.commit()
    return {
        "user_id": str(target.id),
        "base_role": target.role,
        "custom_role_id": str(target.custom_role_id) if target.custom_role_id else None,
        "permissions": resolve_permissions(base, overrides),
    }


# ══════════════════════════════════════════════════════════════════════════════
# JOBS — what a role reaches, set ONCE
# ══════════════════════════════════════════════════════════════════════════════
#
#   "you gave for each page access, fine... but it will make the job tough for
#    layman that they need to keep on doing this. So manager means what and all
#    he can access — read only or write only or both... super admin can choose
#    this... so please don't restrict any, let super admin do anything he wants."
#
# Per-person was the wrong unit of work. Answering "what can a manager do" once,
# and having every manager inherit it, is the difference between a setting and a
# chore. Per-person editing stays for the exceptions.


class JobIn(BaseModel):
    #: The COMPLETE list this job reaches at this hotel.
    permissions: list[str] = Field(default_factory=list)


@router.get("/jobs")
async def list_jobs(
    db: AsyncSession = Depends(get_db), user: User = Depends(require("users:read"))
) -> dict:
    """Every job, what it reaches here, and how many people hold it.

    `everything` is the full catalogue rather than each job's envelope, because
    the owner is entitled to see the whole board before deciding. The envelope
    ships as `suggested` so the UI can WARN when something unusual is switched
    on, without ever refusing.
    """
    rows = {
        r.base_role: r
        for r in (
            await db.execute(select(RoleDefault).where(RoleDefault.hotel_id == user.hotel_id))
        ).scalars()
    }
    counts = dict(
        (
            await db.execute(
                select(User.role, func.count())
                .where(User.hotel_id == user.hotel_id, User.is_active.is_(True))
                .group_by(User.role)
            )
        ).all()
    )
    return {
        "everything": sorted(ALL_PERMISSIONS),
        "jobs": [
            {
                "key": key,
                "label": _LABELS.get(key, key.replace("_", " ").title()),
                "permissions": (
                    list(rows[key].permissions or [])
                    if key in rows
                    else sorted(PERMISSIONS.get(key, []))
                ),
                # What we ship, so the UI can say "you have changed this".
                "shipped": sorted(PERMISSIONS.get(key, [])),
                # What we consider ordinary for the job — a hint, never a wall.
                "suggested": envelope_for(key),
                "customised": key in rows,
                "people": counts.get(key, 0),
            }
            for key in ASSIGNABLE
            if key != Role.KIOSK.value
        ],
    }


@router.put("/jobs/{base_role}")
async def set_job(
    base_role: str,
    payload: JobIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> dict:
    """Say what this job reaches, for everyone who holds it.

    NOT clipped to the archetype envelope. That wall exists to make an unsafe
    grant unrepresentable, which is a good instinct with the wrong owner: the
    person hitting it bought the software and is telling us what their manager
    actually does. The UI warns; the server obeys.

    Only the OWNER may do this. Letting a manager widen the manager role would
    be a manager promoting themselves, which is the one grant that cannot be
    walked back by anybody but the owner.
    """
    if user.role != Role.SUPER_ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the owner can change what a job reaches.",
        )
    if base_role not in ASSIGNABLE or base_role == Role.KIOSK.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a job.")

    # Unknown permission strings are dropped — a typo must not become a grant
    # that nothing in the app can ever satisfy or revoke.
    wanted = sorted({p for p in payload.permissions if p in ALL_PERMISSIONS})

    row = (
        await db.execute(
            select(RoleDefault).where(
                RoleDefault.hotel_id == user.hotel_id, RoleDefault.base_role == base_role
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = RoleDefault(hotel_id=user.hotel_id, base_role=base_role, permissions=wanted)
        db.add(row)
    else:
        row.permissions = wanted

    await audit.record(
        db,
        hotel_id=user.hotel_id,
        user=user,
        action="role.job",
        summary=f"Set what a {_LABELS.get(base_role, base_role).split('—')[0].strip()} can reach",
        entity_type="role",
        entity_id=None,
    )
    await db.commit()
    return {"base_role": base_role, "permissions": wanted}


@router.delete("/jobs/{base_role}")
async def reset_job(
    base_role: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> dict:
    """Put a job back to what DineAI ships. Undo for a bad afternoon."""
    if user.role != Role.SUPER_ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the owner can change what a job reaches."
        )
    row = (
        await db.execute(
            select(RoleDefault).where(
                RoleDefault.hotel_id == user.hotel_id, RoleDefault.base_role == base_role
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
    return {"base_role": base_role, "permissions": sorted(PERMISSIONS.get(base_role, []))}
