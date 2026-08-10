"""Reading and writing an item's buying chain.

Kept apart from `service.py` because `create_item(**fields)` splats its keyword
arguments straight onto the model — a list of rungs is not a column, and the
chain has to be written as its own rows.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import Item, ItemPackLevel
from app.inventory.packs import Level, base_size, legacy_levels


async def set_levels(db: AsyncSession, item: Item, levels: list) -> None:
    """Replace an item's whole chain.

    Replace rather than patch: the rungs only mean anything in order, and each
    one counts the one below it. Editing a single rung in isolation could leave
    "1 box = 10 small boxes" pointing at a rung that no longer exists.
    """
    await db.execute(delete(ItemPackLevel).where(ItemPackLevel.item_id == item.id))
    for position, lv in enumerate(levels or [], start=1):
        contains = Decimal(str(getattr(lv, "contains", 0)))
        name = str(getattr(lv, "name", "")).strip()
        if not name or contains <= 0:
            continue  # a nameless or zero rung would silently poison the chain
        db.add(
            ItemPackLevel(
                item_id=item.id, position=position, name=name[:40], contains=contains
            )
        )
    await db.flush()


async def levels_for(
    db: AsyncSession, item_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ItemPackLevel]]:
    """Every chain for a page of items, in one query rather than N."""
    if not item_ids:
        return {}
    rows = await db.execute(
        select(ItemPackLevel)
        .where(ItemPackLevel.item_id.in_(item_ids))
        .order_by(ItemPackLevel.item_id, ItemPackLevel.position)
    )
    out: dict[uuid.UUID, list[ItemPackLevel]] = {}
    for lv in rows.scalars().all():
        out.setdefault(lv.item_id, []).append(lv)
    return out


def as_levels(rows: list[ItemPackLevel]) -> list[Level]:
    """ORM rows -> the plain dataclass the maths works on."""
    return [Level(position=r.position, name=r.name, contains=r.contains) for r in rows]


def out_rows(item: Item, rows: list[ItemPackLevel] | None) -> list[dict]:
    """What the API sends, with `base_size` already worked out.

    An item created before the chain existed reports its old
    `pack_unit`/`pack_size` here as a single rung, so every screen reads one
    shape and nothing has to be re-entered. Those synthesised rungs carry the
    item's own id — they have no row of their own to point at, and a screen
    only needs them to be stable and distinct.
    """
    if rows:
        levels = as_levels(rows)
        return [
            {
                "id": r.id,
                "position": r.position,
                "name": r.name,
                "contains": r.contains,
                "base_size": base_size(levels, r.position),
            }
            for r in rows
        ]

    legacy = legacy_levels(item.pack_unit, item.pack_size)
    return [
        {
            "id": item.id,
            "position": lv.position,
            "name": lv.name,
            "contains": lv.contains,
            "base_size": base_size(legacy, lv.position),
        }
        for lv in legacy
    ]
