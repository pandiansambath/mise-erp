"""Custom fields and the ready-made field marketplace.

    "have a customisation button like — what if super admin wants one field
     like he wants to get staff's address... also from our side we give one
     more option, like ready-made field marketplace."
    "not only for employee field, but also for vendor page."

One set of endpoints serves both records. `entity` is a path segment rather
than two parallel routers, because the only thing that differs between staff
and suppliers is which catalogue is offered — duplicating the CRUD to express
that would guarantee the two drift.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.custom_fields.catalogue import CATALOGUES, catalogue_for, groups_for
from app.custom_fields.models import CustomField

router = APIRouter(prefix="/custom-fields", tags=["custom-fields"])

#: The types the form renderer can draw. Validated here so a bad type cannot
#: reach the database and produce a field nobody can fill in.
TYPES = {
    "text", "textarea", "number", "money", "date", "select", "checkbox",
    "phone", "email", "url", "file",
}


def _entity(entity: str = Path(...)) -> str:
    if entity not in CATALOGUES:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"No such record type. Expected one of: {', '.join(sorted(CATALOGUES))}",
        )
    return entity


class FieldIn(BaseModel):
    key: str | None = None
    label: str = Field(min_length=1, max_length=120)
    type: str = "text"
    group: str | None = None
    hint: str | None = None
    options: list[str] | None = None
    required: bool = False
    expires: bool = False

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in TYPES:
            raise ValueError(f"Unknown field type '{v}'.")
        return v


class FieldPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    group: str | None = None
    hint: str | None = None
    options: list[str] | None = None
    required: bool | None = None
    expires: bool | None = None
    sort_order: int | None = None
    is_active: bool | None = None


def _slug(label: str) -> str:
    """A stable JSON key from a human label.

    The key is what values are stored under and is never changed afterwards, so
    it has to be derived once and then left alone — renaming the label must not
    orphan everything already typed.
    """
    out = "".join(c.lower() if c.isalnum() else "_" for c in label).strip("_")
    while "__" in out:
        out = out.replace("__", "_")
    return (out or "field")[:60]


def _out(f: CustomField) -> dict:
    return {
        "id": str(f.id),
        "key": f.key,
        "label": f.label,
        "type": f.type,
        "group": f.group,
        "hint": f.hint,
        "options": [o for o in (f.options or "").splitlines() if o.strip()],
        "required": f.required,
        "expires": f.expires,
        "sort_order": f.sort_order,
        "is_active": f.is_active,
        "from_catalogue": f.from_catalogue,
    }


async def _fields(db: AsyncSession, hotel_id, entity: str) -> list[CustomField]:
    rows = await db.execute(
        select(CustomField)
        .where(CustomField.hotel_id == hotel_id, CustomField.entity == entity)
        .order_by(CustomField.sort_order, CustomField.label)
    )
    return list(rows.scalars())


@router.get("/{entity}")
async def list_fields(
    entity: str = Depends(_entity),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    """This hotel's extra fields for one kind of record."""
    rows = await _fields(db, user.hotel_id, entity)
    return {"fields": [_out(f) for f in rows]}


@router.get("/{entity}/marketplace")
async def marketplace(
    entity: str = Depends(_entity),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    """The ready-made fields on offer, with the ones already taken marked.

    Marked rather than filtered out: a shelf with gaps in it is confusing, and
    "you already keep this" is useful information in its own right — it answers
    "did I add that?" without making anyone go and look.
    """
    taken = {
        f.from_catalogue for f in await _fields(db, user.hotel_id, entity) if f.from_catalogue
    }
    items = [{**f, "added": f["key"] in taken} for f in catalogue_for(entity)]
    return {"groups": groups_for(entity), "fields": items}


@router.post("/{entity}", status_code=status.HTTP_201_CREATED)
async def create_field(
    payload: FieldIn,
    entity: str = Depends(_entity),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Add one field — hand-made, or claimed from the marketplace.

    A marketplace pick arrives with its `key` set; a hand-made one gets a key
    derived from its label. Either way the key is settled once, here.
    """
    key = (payload.key or _slug(payload.label)).strip()
    existing = await db.scalar(
        select(CustomField).where(
            CustomField.hotel_id == user.hotel_id,
            CustomField.entity == entity,
            CustomField.key == key,
        )
    )
    if existing is not None:
        # Re-adding a field that was hidden should bring it BACK, with its old
        # values intact, rather than refusing. Hiding is not deleting, and the
        # person pressing "add" wants the field, not an error message.
        if not existing.is_active:
            existing.is_active = True
            await db.commit()
            await db.refresh(existing)
            return _out(existing)
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"You already keep “{existing.label}”."
        )

    rows = await _fields(db, user.hotel_id, entity)
    field = CustomField(
        hotel_id=user.hotel_id,
        entity=entity,
        key=key,
        label=payload.label.strip(),
        type=payload.type,
        group=(payload.group or "").strip() or None,
        hint=(payload.hint or "").strip() or None,
        options="\n".join(payload.options) if payload.options else None,
        required=payload.required,
        expires=payload.expires,
        # Sparse, so a field can later be dropped between two others without
        # renumbering everything.
        sort_order=(max((f.sort_order for f in rows), default=0) + 10),
        from_catalogue=payload.key if payload.key else None,
    )
    db.add(field)
    await db.commit()
    await db.refresh(field)
    return _out(field)


@router.patch("/{entity}/{field_id}")
async def update_field(
    field_id: uuid.UUID,
    payload: FieldPatch,
    entity: str = Depends(_entity),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    field = await db.get(CustomField, field_id)
    if field is None or field.hotel_id != user.hotel_id or field.entity != entity:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such field")
    data = payload.model_dump(exclude_unset=True)
    if "options" in data:
        opts = data.pop("options")
        field.options = "\n".join(opts) if opts else None
    for k, v in data.items():
        setattr(field, k, v)
    # The KEY is deliberately not settable. Renaming a label is free; changing
    # the key would orphan every value already stored under the old one.
    await db.commit()
    await db.refresh(field)
    return _out(field)


@router.delete("/{entity}/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_field(
    field_id: uuid.UUID,
    entity: str = Depends(_entity),
    purge: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> None:
    """Stop keeping a field.

    HIDES by default rather than deleting. The values live in a JSONB column on
    the record, so removing the definition would leave data that nobody can see
    and nobody can get back — and a manager tidying a form has not agreed to
    destroy six months of certificate expiry dates.

    `?purge=true` really removes the definition, which is the right thing for a
    field added by mistake five minutes ago. The values stay in the JSON either
    way; re-adding the same key brings them back.
    """
    field = await db.get(CustomField, field_id)
    if field is None or field.hotel_id != user.hotel_id or field.entity != entity:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such field")
    if purge:
        await db.execute(sa_delete(CustomField).where(CustomField.id == field_id))
    else:
        field.is_active = False
    await db.commit()


class ReorderIn(BaseModel):
    ids: list[uuid.UUID]


@router.post("/{entity}/reorder")
async def reorder(
    payload: ReorderIn,
    entity: str = Depends(_entity),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Set the order of the form, from a drag-and-drop."""
    rows = {str(f.id): f for f in await _fields(db, user.hotel_id, entity)}
    for i, fid in enumerate(payload.ids):
        f = rows.get(str(fid))
        if f is not None:
            f.sort_order = (i + 1) * 10
    await db.commit()
    return {"ok": True}
