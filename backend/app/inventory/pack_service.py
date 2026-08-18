"""Reading and writing an item's buying chain.

Kept apart from `service.py` because `create_item(**fields)` splats its keyword
arguments straight onto the model — a list of rungs is not a column, and the
chain has to be written as its own rows.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory import packs
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


async def per_base_prices(
    db: AsyncSession, item_ids: list[uuid.UUID]
) -> Callable[[uuid.UUID, object, uuid.UUID | None], Decimal]:
    """One loader, then a function that turns any supplier quote into a price
    per BASE unit.

    Written once because it was wrong in three places at the same time and in
    the same way: purchase orders, recipe costing and the opening value of
    imported stock all multiplied an ingredient quantity — which is in base
    units — by a quote that might be for a bottle of thirty. A purchase order
    for one lemon came to £30, that became the received unit cost, and from
    there the item's average cost, the stock value, the expense posted from the
    order and the P&L were all thirty times out.

    His words when he found it on the Inventory screen, and he was right that
    it was not a display bug: "not only here, it's reflecting in all places
    like expense, P&L etc."
    """
    by_item = await levels_for(db, item_ids)
    # TWO shapes, deliberately. The ORM rows carry the `id` a supplier points
    # at; `Level` is the plain dataclass the arithmetic works on and has no id
    # at all — looking one up on the other silently found nothing and every
    # conversion fell through to "treat it as per base", which is the bug this
    # function exists to fix. The tests caught it; a careful read had not.
    chains = {iid: as_levels(rows) for iid, rows in by_item.items()}
    positions = {
        iid: {row.id: row.position for row in rows} for iid, rows in by_item.items()
    }

    def convert(
        item_id: uuid.UUID,
        price,
        level_id: uuid.UUID | None,
        size_override=None,
    ) -> Decimal:
        """What one BASE unit costs from this quote.

        `size_override` is the supplier's OWN pack size, for when their bottle
        is not the same as everybody else's — "some vendor will have 1 bottle =
        30 piece, some vendor will have 1 bottle = 20 piece". It wins over the
        item's chain, because the person opening the delivery is opening THIS
        supplier's bottle.
        """
        if price is None:
            return Decimal("0")
        if size_override is not None:
            size = Decimal(size_override)
            return (Decimal(price) / size) if size > 0 else Decimal(price)
        if level_id is None:
            return Decimal(price)
        position = positions.get(item_id, {}).get(level_id)
        if position is None:
            # The supplier points at a rung this item no longer has. Treat the
            # quote as per base rather than inventing a conversion — being
            # honest about not knowing beats being confidently wrong about money.
            return Decimal(price)
        return packs.price_per_base(price, chains.get(item_id, []), position)

    return convert


async def ensure_level(
    db: AsyncSession, item: Item, name: str, wanted_base: Decimal
) -> ItemPackLevel | None:
    """Find the rung a supplier means by `name`, creating it if it is new.

    His correction, and it is the right shape:

        "we need to add these and all in each vendor page right? ... but still
         you have that add-size feature in inventory itself — that size needs to
         be auto-picked like price bro, auto pick from vendor and show in
         inventory."

    So the SUPPLIER names the pack, the way they already name the price, and
    inventory reads it back rather than asking for it. A name that already
    exists is reused as-is: how big THIS supplier's version is belongs on their
    own row (`pack_size_override`), because that is exactly the case where two
    suppliers say "bottle" and mean different numbers.

    Appending only, never rewriting. `vendor_items.pack_level_id` is
    ON DELETE SET NULL, so replacing the chain would silently un-set the pack
    every other supplier had chosen.
    """
    clean = (name or "").strip()
    if not clean or wanted_base is None or wanted_base <= 0:
        return None

    rows = (await levels_for(db, [item.id])).get(item.id) or []
    for r in rows:
        if r.name.strip().lower() == clean.lower():
            return r

    # A new rung on the end. The chain stores the STEP up from the rung below,
    # so the step is whatever turns that rung's size into the one asked for.
    levels = as_levels(rows)
    below = base_size(levels, rows[-1].position) if rows else Decimal(1)
    step = Decimal(str(wanted_base)) / (below or Decimal(1))
    if step <= 0:
        return None

    row = ItemPackLevel(
        item_id=item.id,
        position=(rows[-1].position + 1) if rows else 1,
        name=clean[:40],
        contains=step,
    )
    db.add(row)
    await db.flush()
    return row
