"""How the bell's rows are shaped — pure, so its one promise can be tested.

    "if I get so many notifications from different area means one area is
     dominating and makes others to be very bottom, that I need to scroll to
     check that. eg: price alerts has 10+ notifications which is hiding some
     important ones."

A flat list cannot keep that promise. Sorting by severity (the first half of
32.12, shipped earlier) stops a warning outranking a danger, but ten price rises
still push the quiet "your passport was asked for" off the bottom of the panel —
equal severity, so nothing in a sort can say one matters more. What can is the
SHAPE: one box per area, each showing its first few rows, so a noisy area grows
its own "+N more" instead of growing the page.

Five stages, in this order, and each is a function below so it can be read and
tested alone:

    BUILD     the router turns rows the features already wrote into items.
              (Not here: it needs the database. Everything after it does not.)
    LIFT      every `danger` row is pulled OUT before any box is built. It goes
              in the box's `pinned` list — shown above the run, never inside it.
    COLLAPSE  what is left goes into one box per area: the first `show` rows
              visible, the rest behind "+N more".
    SORT      boxes are ordered danger-first, then For you, then by severity,
              then by a FIXED area order — never by count, or the boxes would
              reshuffle under the cursor every time somebody read one.
    CAP       a box carries at most `cap` ordinary rows; beyond that it says how
              many it is holding back and links to the page that has them all.

ONE INVARIANT, AND IT IS HIS SENTENCE:

    No `severity: danger` item can ever be collapsed, capped or trimmed.

LIFT is what makes the other three safe. A danger row is out of the run before
the box exists, so COLLAPSE cannot fold it, CAP cannot count it and nothing can
cut it. A dismissal cannot hide one either, and nor can muting its area: an
empty chicken bin stays on screen until somebody fills it, which is the only
thing that should make it go away. `tests/test_notification_pipeline.py` holds
this with fifty noisy rows and a cap of zero.
"""
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

DANGER = "danger"
WARN = "warn"
INFO = "info"
SEV_RANK: dict[str, int] = {DANGER: 0, WARN: 1, INFO: 2}

#: Rows a box shows before "+N more". Three, because three is what fits in a
#: glance — and a fourth price rise is not news, it is a pattern, which is what
#: the count beside the box is for.
SHOW = 3
#: Ordinary rows a box carries at all. Danger rows are NOT counted against it.
CAP = 12
#: Dismissed rows sent back so they can be restored. More than this and the
#: "put away" list is itself the noise it was meant to clear.
DISMISSED_CAP = 30

#: A muted area is a state row like any other, keyed on the area. `area:` can
#: never collide with a notification id, because no stream emits that prefix.
MUTE_PREFIX = "area:"


def rank(severity: str | None) -> int:
    return SEV_RANK.get(severity or INFO, SEV_RANK[INFO])


@dataclass(frozen=True)
class Area:
    key: str
    label: str
    icon: str
    #: The door to the area's own page — "see all" when a box is capped.
    route: str


#: The FIXED order boxes fall back to. "For you" leads its tier because a thing
#: asked of you personally is the one most easily buried and least able to be
#: found again somewhere else.
AREAS: tuple[Area, ...] = (
    Area("mine", "For you", "🙋", "/my"),
    Area("stock", "Stock", "📦", "/inventory"),
    Area("prices", "Supplier prices", "📈", "/price-comparison"),
    Area("purchasing", "Deliveries & orders", "🚚", "/purchasing"),
    Area("suppliers", "Suppliers", "🤝", "/vendors"),
    Area("sales", "Sales", "🧾", "/sales"),
    Area("money", "Expenses", "💸", "/expenses"),
    Area("rota", "Rota", "🗓️", "/rota"),
    Area("attendance", "Attendance", "🕒", "/attendance"),
    Area("payroll", "Payroll", "💷", "/payroll"),
    Area("tables", "Tables", "🪑", "/tables"),
    Area("menu", "Menu & recipes", "🍛", "/recipes"),
    Area("team", "People & access", "👥", "/staff"),
    Area("assistant", "Assistant", "✨", "/dashboard"),
    Area("other", "Everything else", "📝", "/audit"),
)
AREA_BY_KEY: dict[str, Area] = {a.key: a for a in AREAS}
_AREA_ORDER: dict[str, int] = {a.key: i for i, a in enumerate(AREAS)}

# KEYED ON THE ACTION PREFIX, NOT THE EXACT ACTION.
#
# An exact-key table only ever covers what somebody remembered to add: `shift.`
# was missing, so `shift.move` — a real rota action — fell through to "📝 Shift
# Move" under Everything else. A prefix covers the family, including actions
# that do not exist yet. First match wins, so an exact action listed above its
# family can still be routed somewhere else.
_ACTION_AREAS: tuple[tuple[str, str], ...] = (
    ("ai.commit_bill", "purchasing"),  # a scanned bill booked in IS a delivery
    ("sale.", "sales"),
    ("sales.", "sales"),
    ("expense.", "money"),
    ("stock.", "stock"),
    ("inventory.", "stock"),
    ("po.", "purchasing"),
    ("indent.", "purchasing"),
    ("vendor.", "suppliers"),
    ("vendors.", "suppliers"),
    ("payroll.", "payroll"),
    ("shift.", "rota"),
    ("attendance.", "attendance"),
    ("table.", "tables"),
    ("recipes.", "menu"),
    ("recipe.", "menu"),
    ("staff.", "team"),
    ("user.", "team"),
    ("role.", "team"),
    ("employee.", "team"),
    ("employees.", "team"),
    ("assistant.", "assistant"),
)


def area_for_action(action: str) -> str:
    """Which box an audit action belongs in. Unknown families → `other`."""
    for prefix, area in _ACTION_AREAS:
        if action == prefix or (prefix.endswith(".") and action.startswith(prefix)):
            return area
    return "other"


def mute_key(area: str) -> str:
    return f"{MUTE_PREFIX}{area}"


@dataclass(frozen=True)
class Mark:
    """What one person has done to one notification. Absent means neither."""

    read: bool = False
    dismissed: bool = False


_NO_MARK = Mark()


# ── the stages ─────────────────────────────────────────────────────────────


def apply_marks(
    items: Iterable[dict], marks: Mapping[str, Mark]
) -> tuple[list[dict], list[dict], dict[str, int]]:
    """Stamp each row with this person's state; set aside what they put away.

    Returns `(live, dismissed, muted_counts)`.

    A DISMISSAL NEVER APPLIES TO DANGER, and neither does a mute. Not as a UI
    nicety — the client hides the button too — but here, because the key a
    person dismissed is not always the thing they are now looking at: a low
    stock warning dismissed on Monday becomes an out-of-stock on Wednesday, and
    "I've seen it's getting low" must not silence "it's gone".
    """
    muted = {
        k[len(MUTE_PREFIX):]
        for k, m in marks.items()
        if k.startswith(MUTE_PREFIX) and m.dismissed
    }
    live: list[dict] = []
    put_away: list[dict] = []
    muted_counts: dict[str, int] = {}
    for it in items:
        m = marks.get(it["id"], _NO_MARK)
        row = {**it, "read": bool(it.get("read")) or m.read}
        if it.get("severity") == DANGER:
            live.append(row)
            continue
        if m.dismissed:
            put_away.append({**row, "dismissed": True})
            continue
        if it["area"] in muted:
            muted_counts[it["area"]] = muted_counts.get(it["area"], 0) + 1
            continue
        live.append(row)
    return live, put_away, muted_counts


def lift(rows: Iterable[dict]) -> tuple[list[dict], list[dict]]:
    """LIFT: `(exceptional, ordinary)`. Danger is out before any box exists."""
    exceptional: list[dict] = []
    ordinary: list[dict] = []
    for r in rows:
        (exceptional if r.get("severity") == DANGER else ordinary).append(r)
    return exceptional, ordinary


def _box(area_key: str) -> dict:
    a = AREA_BY_KEY.get(area_key, AREA_BY_KEY["other"])
    return {
        "area": a.key,
        "label": a.label,
        "icon": a.icon,
        "route": a.route,
        "pinned": [],
        "items": [],
        "more": [],
        "hidden": 0,
    }


def collapse(exceptional: list[dict], ordinary: list[dict], *, show: int = SHOW) -> list[dict]:
    """COLLAPSE: one box per area — pinned danger, then `show` rows, then more.

    Within a box, warnings outrank information, and STABLY: equal severities
    keep the order they were built in (newest first for activity), so rows do
    not shuffle under the cursor between polls.

    The counts are taken HERE, before CAP, so a box that is holding rows back
    still tells the truth about how many there are.
    """
    boxes: dict[str, dict] = {}
    runs: dict[str, list[dict]] = {}

    def key_of(r: dict) -> str:
        k = r.get("area") or "other"
        k = k if k in AREA_BY_KEY else "other"
        if k not in boxes:
            boxes[k] = _box(k)
            runs[k] = []
        return k

    for r in exceptional:
        boxes[key_of(r)]["pinned"].append(r)
    for r in sorted(ordinary, key=lambda r: rank(r.get("severity"))):
        runs[key_of(r)].append(r)

    for key, g in boxes.items():
        run_ = runs[key]
        every = g["pinned"] + run_
        g["total"] = len(every)
        g["unread"] = sum(1 for r in every if not r.get("read"))
        g["urgent"] = len(g["pinned"])
        g["urgent_unread"] = sum(1 for r in g["pinned"] if not r.get("read"))
        g["worst"] = min((r.get("severity") or INFO for r in every), key=rank, default=INFO)
        g["items"] = run_[: max(0, show)]
        g["more"] = run_[max(0, show):]
    return list(boxes.values())


def sort_groups(groups: list[dict]) -> list[dict]:
    """SORT: danger areas, then For you, then warnings, then the rest.

    Ties fall to the fixed area order rather than to how many rows a box has —
    ranking by volume is exactly how a noisy area wins, which is the complaint.
    """

    def key(g: dict) -> tuple[int, int, int, int]:
        worst = rank(g.get("worst"))
        return (
            0 if worst == SEV_RANK[DANGER] else 1,
            0 if g["area"] == "mine" else 1,
            worst,
            _AREA_ORDER.get(g["area"], len(_AREA_ORDER)),
        )

    return sorted(groups, key=key)


def cap(groups: list[dict], *, limit: int = CAP) -> list[dict]:
    """CAP: at most `limit` ORDINARY rows per box; `hidden` says how many more.

    `pinned` is not read, not counted and not touched here. That is the whole
    reason LIFT runs first.
    """
    limit = max(0, limit)
    for g in groups:
        ordinary = g["items"] + g["more"]
        keep = ordinary[:limit]
        shown = len(g["items"])
        g["items"] = keep[:shown]
        g["more"] = keep[shown:]
        g["hidden"] = len(ordinary) - len(keep)
    return groups


def run(
    items: Iterable[dict],
    marks: Mapping[str, Mark] | None = None,
    *,
    show: int = SHOW,
    limit: int = CAP,
) -> dict:
    """The whole pipeline after BUILD. `items` need `id`, `area`, `severity`."""
    live, put_away, muted_counts = apply_marks(items, marks or {})
    groups = cap(sort_groups(collapse(*lift(live), show=show)), limit=limit)
    muted = [
        {
            "area": k,
            "label": AREA_BY_KEY.get(k, AREA_BY_KEY["other"]).label,
            "icon": AREA_BY_KEY.get(k, AREA_BY_KEY["other"]).icon,
            "count": muted_counts.get(k, 0),
        }
        for k in sorted(
            {k[len(MUTE_PREFIX):] for k, m in (marks or {}).items()
             if k.startswith(MUTE_PREFIX) and m.dismissed},
            key=lambda k: _AREA_ORDER.get(k, len(_AREA_ORDER)),
        )
    ]
    return {
        "groups": groups,
        "dismissed": put_away[:DISMISSED_CAP],
        "dismissed_count": len(put_away),
        "muted": muted,
        "total": sum(g["total"] for g in groups),
        "unread": sum(g["unread"] for g in groups),
        "urgent": sum(g["urgent"] for g in groups),
        "urgent_unread": sum(g["urgent_unread"] for g in groups),
    }
