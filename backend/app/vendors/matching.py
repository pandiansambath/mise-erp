"""Matching a supplier's wording to your own inventory.

The fault this fixes: prices were attached by EXACT item name, so a vendor
writing "Tomatos" against your "Tomato" failed outright with "item not found".
One character. It surfaced on document upload, where a whole price list can be
rejected over spelling nobody controls.

Agreed with him on 2026-08-07, in this order — cheapest and most certain
first, so the expensive step almost never runs:

1. **An alias we already learned.** Once somebody confirms that Farm2Land's
   "Tomatos" is our "Tomato", it is never asked again. This is the part that
   compounds: the system gets quieter the longer it is used.
2. **Exact name**, case- and space-insensitive.
3. **Fuzzy**, via Postgres trigram similarity. Catches typos, plurals and
   spacing without a model or a network call.
4. **Embeddings**, only when fuzzy is not confident. This is the one that knows
   brinjal is aubergine — and the only one that costs money, which is why it
   sits last and behind a threshold.

Nothing here CREATES an inventory item. An unmatched name comes back as
candidates for a person to choose from, because silently inventing "Tomatos"
alongside "Tomato" splits the stock of one ingredient across two rows and
quietly corrupts costing and every recipe that uses it.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import Item
from app.vendors.models import ItemAlias

# Below this, a trigram hit is a coincidence rather than a match.
FUZZY_FLOOR = 0.34
# At or above this we are confident enough not to ask — and not to pay for an
# embedding.
FUZZY_SURE = 0.62


def normalise(name: str) -> str:
    """Fold the differences that are never meaningful in an item name."""
    n = (name or "").strip().lower()
    n = re.sub(r"[^a-z0-9 ]+", " ", n)
    return re.sub(r"\s+", " ", n).strip()


@dataclass
class Match:
    item_id: uuid.UUID | None
    name: str
    score: float
    how: str  # alias | exact | fuzzy | embedding
    candidates: list[dict]


async def resolve(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    raw_name: str,
    *,
    vendor_id: uuid.UUID | None = None,
) -> Match:
    """Find which inventory item a supplier means. Never guesses silently."""
    wanted = normalise(raw_name)
    if not wanted:
        return Match(None, raw_name, 0.0, "none", [])

    # 1 ── something we were already told
    q = select(ItemAlias).where(
        ItemAlias.hotel_id == hotel_id, ItemAlias.alias == wanted
    )
    rows = (await db.execute(q)).scalars().all()
    # A vendor-specific alias beats a general one: two suppliers can use the
    # same word for different things.
    rows.sort(key=lambda a: (a.vendor_id != vendor_id, a.vendor_id is None))
    if rows:
        item = await db.get(Item, rows[0].item_id)
        if item is not None:
            return Match(item.id, item.name, 1.0, "alias", [])

    items = (
        await db.execute(select(Item).where(Item.hotel_id == hotel_id))
    ).scalars().all()
    if not items:
        return Match(None, raw_name, 0.0, "none", [])

    # 2 ── the same name, written differently
    for it in items:
        if normalise(it.name) == wanted:
            return Match(it.id, it.name, 1.0, "exact", [])

    # 3 ── close enough to propose. Trigram similarity runs in Postgres, so
    # this is a query rather than a model.
    scored: list[tuple[float, Item]] = []
    try:
        sims = await db.execute(
            text("SELECT similarity(:a, lower(name)) AS s, id FROM items WHERE hotel_id = :h"),
            {"a": wanted, "h": str(hotel_id)},
        )
        by_id = {str(i.id): i for i in items}
        for s, iid in sims:
            it = by_id.get(str(iid))
            if it is not None and s is not None:
                scored.append((float(s), it))
    except Exception:  # noqa: BLE001 — pg_trgm missing: fall back to Python
        scored = [(_ratio(wanted, normalise(i.name)), i) for i in items]

    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[0] if scored else (0.0, None)
    shortlist = [
        {"item_id": str(i.id), "name": i.name, "unit": i.unit, "score": round(sc, 3)}
        for sc, i in scored[:5]
        if sc >= FUZZY_FLOOR
    ]

    if best[1] is not None and best[0] >= FUZZY_SURE:
        return Match(best[1].id, best[1].name, best[0], "fuzzy", shortlist)

    # 4 ── the expensive one, reached only when the cheap ones were unsure.
    # Deliberately a hook: wiring the model in is a separate, costed decision,
    # and everything above must be in place first or it would be paying to
    # answer questions a string comparison already could.
    return Match(None, raw_name, best[0] if best[1] else 0.0, "unsure", shortlist)


def _ratio(a: str, b: str) -> float:
    """A trigram overlap, for when pg_trgm is not installed."""
    def grams(x: str) -> set[str]:
        p = f"  {x} "
        return {p[i : i + 3] for i in range(len(p) - 2)}

    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)
