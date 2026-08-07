"""Deciding which stock item a supplier means.

A vendor's paperwork says "Tomatos 1kg Box". Your inventory says "Tomato". Exact
string matching says no, and the import dies with "item not found" — which is
what happens today.

The design is shaped by the fact that the two ways this can fail are NOT equally
bad:

* **Missing a match** is loud. You see "not found", you fix it, nothing is wrong
  in the data.
* **Matching the WRONG item** is silent. A price lands on the wrong stock line,
  every recipe using it is quietly mis-costed, and no screen ever says so.

For a product whose whole promise is that no money goes missing, the second is
far more expensive. So this module will happily return "I am not sure" and hand
the decision back, and it NEVER picks a fuzzy candidate on its own.

Three layers, in order of authority:

1. **Exact**, on a normalised form — "Tomatos 1kg Box" and "tomato" reduce to
   the same thing, and that reduction is deterministic.
2. **Alias** — a remembered decision. Once you confirm that THIS vendor's
   "Tomatos 1kg Box" is your "Tomato", it is exact forever after. This is what
   makes the feature compound instead of asking the same forty questions weekly.
3. **Fuzzy** — offers ranked candidates and nothing more. The caller shows them;
   a human chooses.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import Item, VendorItemAlias

# Pack and unit noise. A supplier writes "1kg", "500 g", "x12", "box", "pkt";
# none of it identifies WHICH item this is, and all of it defeats comparison.
_UNIT_NOISE = re.compile(
    r"\b("
    r"\d+(\.\d+)?\s?(kg|kgs|g|gm|gms|gram|grams|l|ltr|ltrs|litre|litres|ml|oz|lb|lbs|pc|pcs|piece|pieces)"
    r"|x\s?\d+"
    r"|box|boxes|packet|packets|pkt|pack|packs|bag|bags|tin|tins|can|cans|bottle|bottles|case|cases|crate|crates|tray|trays|jar|jars|sack|sacks"
    r"|fresh|frozen|dried|raw|whole|premium|quality|grade\s?[a-z0-9]?"
    r")\b"
)
_PUNCT = re.compile(r"[^a-z0-9\s]")
_SPACES = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Reduce a product name to what actually identifies it.

    "Fresh Tomatos 1kg Box" -> "tomato". Crude on purpose: a rule you can read
    and predict beats a clever one that surprises you on a Friday night.
    """
    s = (text or "").lower().strip()
    s = _PUNCT.sub(" ", s)
    s = _UNIT_NOISE.sub(" ", s)
    s = _SPACES.sub(" ", s).strip()
    # Crude singularisation, applied per word. "tomatoes"->"tomato",
    # "tomatos"->"tomato", "chillies"->"chilli". Wrong for a few English words
    # but consistent — and both sides of the comparison get the same treatment,
    # which is what actually matters.
    words = []
    for w in s.split():
        if len(w) > 3 and w.endswith("ies"):
            w = w[:-3] + "y"
        elif len(w) > 3 and w.endswith("es"):
            w = w[:-2]
        elif len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        words.append(w)
    return " ".join(words)


def similarity(a: str, b: str) -> float:
    """0..1. Blends whole-string closeness with word overlap.

    Two measures because they fail differently: SequenceMatcher handles typos
    and plurals but is fooled by word order, while token overlap handles
    "chilli powder" vs "powder chilli" but not "tomatos" vs "tomato". Taking the
    max means either one can rescue a real match.
    """
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ratio = SequenceMatcher(None, a, b).ratio()
    ta, tb = set(a.split()), set(b.split())
    overlap = len(ta & tb) / len(ta | tb) if (ta | tb) else 0.0
    return max(ratio, overlap)


@dataclass
class Candidate:
    item_id: uuid.UUID
    name: str
    score: float


@dataclass
class MatchResult:
    """How the name was resolved, and how much to trust it.

    `status` is the whole point of the return type:
      exact   — normalised names are identical
      alias   — a decision somebody already confirmed
      unsure  — candidates found, NOBODY may act on these without a human
      none    — nothing close enough to offer
    """

    status: str
    item_id: uuid.UUID | None = None
    item_name: str | None = None
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def certain(self) -> bool:
        return self.status in ("exact", "alias")



# ── Words for the same ingredient ─────────────────────────────────────────
#
# Spelling similarity cannot help here. "Cottage cheese" and "paneer" share
# almost no letters, so the trigram score is near zero — his exact example.
# The two names are only connected by knowing what they MEAN.
#
# Most of that meaning, for a kitchen, is a short list. This is an
# Indian-British restaurant: the same ingredient routinely arrives under an
# Indian name from one supplier and a British one from another, and the pairs
# are stable and well known. A lookup answers instantly, costs nothing, works
# offline and is auditable — everything an embedding is not.
#
# Embeddings still earn their place for the long tail (see `semantic_hint`),
# but they should not be paying to rediscover that brinjal is aubergine.
SYNONYMS: list[set[str]] = [
    {"paneer", "cottage cheese", "indian cheese"},
    {"aubergine", "brinjal", "eggplant"},
    {"coriander", "cilantro", "dhania", "coriander leaves"},
    {"capsicum", "bell pepper", "sweet pepper", "shimla mirch"},
    {"okra", "ladies finger", "lady finger", "bhindi"},
    {"prawn", "prawns", "shrimp", "shrimps"},
    {"chickpeas", "chana", "garbanzo", "garbanzo beans", "kabuli chana"},
    {"lentils", "dal", "daal", "dhal"},
    {"clarified butter", "ghee"},
    {"yoghurt", "yogurt", "curd", "dahi"},
    {"gram flour", "besan", "chickpea flour"},
    {"semolina", "sooji", "rava"},
    {"flatbread", "roti", "chapati", "chapatti"},
    {"cornflour", "corn starch", "cornstarch"},
    {"spring onion", "scallion", "green onion"},
    {"beetroot", "beet", "beets"},
    {"courgette", "zucchini"},
    {"rocket", "arugula"},
    {"swede", "rutabaga"},
    {"mange tout", "snow peas", "snowpeas"},
    {"double cream", "heavy cream", "whipping cream"},
    {"caster sugar", "superfine sugar"},
    {"plain flour", "all purpose flour", "maida"},
    {"cumin", "jeera"},
    {"turmeric", "haldi"},
    {"fenugreek", "methi"},
    {"mustard seeds", "rai", "sarson"},
    {"curry leaves", "kadi patta"},
    {"black gram", "urad", "urad dal"},
]

# Built once: every word points at the set it belongs to.
_SYN_INDEX: dict[str, int] = {}
for _i, _group in enumerate(SYNONYMS):
    for _word in _group:
        _SYN_INDEX[_word] = _i


def same_ingredient(a: str, b: str) -> bool:
    """Do these two names mean the same thing, spelling aside?"""
    ga = _SYN_INDEX.get(normalise(a))
    gb = _SYN_INDEX.get(normalise(b))
    return ga is not None and ga == gb


# Below this, a suggestion is noise rather than help.
SUGGEST_FLOOR = 0.55
MAX_CANDIDATES = 5


async def resolve(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    raw_name: str,
    *,
    vendor_id: uuid.UUID | None = None,
    items: list[Item] | None = None,
) -> MatchResult:
    """Work out which item `raw_name` refers to. Never guesses."""
    target = normalise(raw_name)
    if not target:
        return MatchResult(status="none")

    if items is None:
        rows = await db.execute(select(Item).where(Item.hotel_id == hotel_id))
        items = list(rows.scalars())

    # 1. Exact, on the normalised form.
    for item in items:
        if normalise(item.name) == target:
            return MatchResult(status="exact", item_id=item.id, item_name=item.name)

    # 2. A remembered decision. Vendor-specific aliases win over general ones:
    #    one supplier's shorthand should not speak for every other supplier.
    alias_rows = await db.execute(
        select(VendorItemAlias).where(
            VendorItemAlias.hotel_id == hotel_id,
            VendorItemAlias.alias_text == target,
        )
    )
    aliases = list(alias_rows.scalars())
    chosen = next((a for a in aliases if a.vendor_id == vendor_id), None) or next(
        (a for a in aliases if a.vendor_id is None), None
    )
    if chosen is not None:
        item = next((i for i in items if i.id == chosen.item_id), None)
        if item is not None:
            return MatchResult(status="alias", item_id=item.id, item_name=item.name)

    # 3. The same ingredient under another name.
    #
    #    Treated as a SUGGESTION, not a decision: paneer and cottage cheese
    #    are near-equivalents rather than identical — paneer does not melt,
    #    cottage cheese is wetter — and a kitchen may genuinely stock both. So
    #    it goes to the top of the list and a person still says yes. One
    #    confirmation writes an alias and it is never asked again.
    known = [i for i in items if same_ingredient(target, i.name)]
    if known:
        return MatchResult(
            status="unsure",
            candidates=[
                Candidate(item_id=i.id, name=i.name, score=0.95) for i in known
            ],
        )

    # 4. Offer candidates. Deliberately does NOT pick one, however high the
    #    score — see the note at the top about which failure costs more.
    scored = [
        Candidate(item_id=i.id, name=i.name, score=round(similarity(target, normalise(i.name)), 3))
        for i in items
    ]
    scored = [c for c in scored if c.score >= SUGGEST_FLOOR]
    scored.sort(key=lambda c: c.score, reverse=True)
    if not scored:
        return MatchResult(status="none")
    return MatchResult(status="unsure", candidates=scored[:MAX_CANDIDATES])


async def remember(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    raw_name: str,
    item_id: uuid.UUID,
    *,
    vendor_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
) -> VendorItemAlias | None:
    """Record a confirmed match so it never has to be asked again.

    Scoped to the vendor when we know it. Idempotent: confirming the same thing
    twice updates the existing row rather than stacking duplicates that would
    later disagree with each other.
    """
    text = normalise(raw_name)
    if not text:
        return None

    existing = await db.execute(
        select(VendorItemAlias).where(
            VendorItemAlias.hotel_id == hotel_id,
            VendorItemAlias.alias_text == text,
            VendorItemAlias.vendor_id == vendor_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        row.item_id = item_id  # a correction wins
        return row

    row = VendorItemAlias(
        hotel_id=hotel_id,
        vendor_id=vendor_id,
        alias_text=text,
        original_text=raw_name[:200],
        item_id=item_id,
        created_by=user_id,
    )
    db.add(row)
    return row
