"""In-app notifications — a lightweight aggregator of what the user should know
right now. Three streams, all computed on the fly and strictly hotel-scoped:

  • ALERTS   — actionable states needing attention: supplier PRICE RISES + LOW/OUT
               of stock.
  • ACTIVITY — a live feed of everything happening in the business (sales, waste,
               deliveries, payroll, shifts, expenses, price changes…), read straight
               from the audit log so the bell doubles as a "recent history".
  • MINE     — things addressed to THIS PERSON. Added 2026-09-16:

                   "Requesting a document, or putting someone on the rota, must
                    notify THEM."

               The other two streams are hotel-wide and PERMISSION-gated, which
               means a chef sees nothing: `shift.add` requires `employees:read`,
               a permission a kitchen porter does not have and should not have.
               So the two features that are ABOUT a staff member notified
               everyone except the staff member.

               This stream is gated on IDENTITY instead — you always see what
               was asked of you — and it is still computed on the fly, from the
               rows the features already write. No new table, nothing to keep
               in step.

The streams are BUILT here and then shaped by `pipeline.py` — LIFT, COLLAPSE,
SORT, CAP — into one box per area, so a noisy area grows its own "+N more"
instead of burying a quiet one (32.12). What each person has read or put away
is the only thing stored (`notification_state`, 32.13); the notifications
themselves are never copied into a table.
"""
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit_service
from app.auth.deps import effective_permissions, get_current_user
from app.auth.models import User
from app.core.database import get_db
from app.core.rbac import NARROWER_THAN, has_permission
from app.documents.models import DocRequestStatus, DocumentRequest
from app.employees.models import Employee
from app.inventory import service as inv_service
from app.notifications import pipeline
from app.notifications import state as state_service
from app.reports import insights
from app.rota.models import Shift

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Exact action → (icon, friendly title, route, permission required to SEE it).
_ACTIVITY: dict[str, tuple[str, str, str, str]] = {
    "sale.add": ("🧾", "Sales recorded", "/sales", "sales:read"),
    "expense.add": ("💸", "Expense added", "/expenses", "expenses:read"),
    "expense.delete": ("💸", "Expense removed", "/expenses", "expenses:read"),
    # Marking a category as set-aside money moves its whole history out of
    # profit. Unmapped, it would show only to users:read — not to the people
    # whose numbers just changed.
    "expense.reserve": ("🏦", "Set-aside money changed", "/expenses", "expenses:read"),
    "stock.waste": ("🗑️", "Waste logged", "/waste", "inventory:read"),
    "po.received": ("📦", "Delivery received", "/purchasing", "indent:read"),
    "vendor.price": ("💷", "Vendor price updated", "/price-comparison", "vendors:read"),
    "vendor.chosen": ("⭐", "Preferred vendor set", "/vendors", "vendors:read"),
    "payroll.run": ("💷", "Payroll run", "/payroll", "payroll:read"),
    "payroll.approve_all": ("✅", "Payroll approved", "/payroll", "payroll:read"),
    "payroll.approve": ("✅", "Payslip approved", "/payroll", "payroll:read"),
    "payroll.pay": ("💷", "Payslip paid", "/payroll", "payroll:read"),
    "shift.add": ("🗓️", "Shift added", "/rota", "employees:read"),
    "shift.delete": ("🗓️", "Shift removed", "/rota", "employees:read"),
    "attendance.set": ("🕒", "Attendance updated", "/attendance", "attendance:read"),
    "inventory.import": ("📥", "Inventory imported", "/inventory", "inventory:read"),
    "inventory.seed_starter": ("📦", "Starter items added", "/inventory", "inventory:read"),
}
# Prefix fallbacks for the "family" of actions (inventory.create/update/archive…).
_PREFIX: list[tuple[str, tuple[str, str, str, str]]] = [
    # `shift.` was missing entirely, so `shift.move` — a real rota action —
    # rendered as "📝 Shift Move" and was visible ONLY to users:read, which
    # is to say not to the rota people. A prefix covers the family; an exact
    # key list only ever covers what somebody remembered to add.
    # Added with 32.21. Without a prefix entry a table rename renders as
    # "📝 Table Update" and is visible only to users:read — i.e. not to the
    # people who run the room. Same gap `shift.` had.
    ("table.", ("🪑", "Tables changed", "/tables", "orders:read")),
    ("shift.", ("🗓️", "Rota changed", "/rota", "employees:read")),
    ("attendance.", ("🕒", "Attendance updated", "/attendance", "attendance:read")),
    ("inventory.", ("📦", "Inventory updated", "/inventory", "inventory:read")),
    ("payroll.", ("💷", "Payroll updated", "/payroll", "payroll:read")),
    ("assistant.", ("✨", "Assistant action", "/dashboard", "reports:read")),
]


def _activity_meta(action: str) -> tuple[str, str, str, str | None]:
    """(icon, title, route, permission) for an audit action — permission None means
    it's a generic event only admins (users:read) should see."""
    if action in _ACTIVITY:
        return _ACTIVITY[action]
    for prefix, meta in _PREFIX:
        if action.startswith(prefix):
            return meta
    return ("📝", action.replace(".", " ").replace("_", " ").title(), "", None)


async def _permission_check(db: AsyncSession, user: User) -> Callable[[str], bool]:
    """`can(permission)` for THIS person, custom role included.

    The bell used `has_permission(user.role, …)`, which knows only the shipped
    base roles. A hotel that invented its own job ("Poori Master") or redefined
    what a manager reaches got a bell answering for the job WE ship rather than
    the one they set — stock alerts missing for somebody who can open the stock
    page, or present for somebody who cannot. Same rule as `require()`, so the
    bell and the pages it links to agree about who may see what.
    """
    granted = await effective_permissions(db, user)
    if granted is None:
        return lambda perm: has_permission(user.role, perm)
    have = set(granted)

    def can(perm: str) -> bool:
        if "*" in have or perm in have:
            return True
        module = perm.rsplit(":", 1)[0]
        if perm.endswith(":read") and f"{module}:write" in have:
            return True
        wider = NARROWER_THAN.get(perm)
        return bool(wider) and can(wider)

    return can


# ── BUILD ──────────────────────────────────────────────────────────────────


async def _build(db: AsyncSession, user: User) -> list[dict]:
    """Every row this person may see, flat, before any shaping.

    Nothing is trimmed here. The old low-stock `[:15]` cut an UNORDERED list,
    so the sixteenth row could be an out-of-stock and simply not exist — the
    invariant broken before the shaping even began. Trimming is CAP's job, and
    CAP is not allowed to touch danger.
    """
    can = await _permission_check(db, user)
    items: list[dict] = []

    # Supplier price rises — only if the user can see costs/inventory. Newest first.
    if can("inventory:read") or can("reports:read"):
        rises = sorted(
            # Fifty, not the report's ten: the box shows three and says how
            # many more there are, and "10+" was the number he complained of —
            # a count that stops at the limit is not a count.
            await insights.price_alerts(db, user.hotel_id, limit=50),
            key=lambda a: a["last_ordered"], reverse=True,
        )
        for a in rises:
            vendor = a.get("vendor_name") or "a supplier"
            body = f"{vendor}: £{a['prev_price']} → £{a['latest_price']} (+{a['change_pct']}%)"
            items.append({
                "id": f"price:{a['item_id']}:{a['latest_price']}",
                "kind": "price_rise",
                "stream": "alert",
                "area": "prices",
                "severity": "warn",
                "icon": "📈",
                "title": f"Price up — {a['item_name']}",
                "body": body,
                "route": "/price-comparison",
                # A DATE, not a moment — the client shows "30 Oct", not "3 hr ago".
                "at": a["last_ordered"].isoformat() if a.get("last_ordered") else None,
                "who": "",
            })

    # Low / out of stock.
    if can("inventory:read"):
        for it in await inv_service.low_stock_items(db, user.hotel_id):
            qty = it.current_stock
            out = qty is not None and qty <= 0
            minlvl = it.min_stock_level
            body = f"{qty} {it.unit} left" + (f" (min {minlvl})" if minlvl is not None else "")
            items.append({
                # OUT IS A DIFFERENT NOTIFICATION FROM LOW, so it has its own id.
                # They used to share `low:<item>`, which would have meant that
                # reading "getting low" on Monday marked "it's gone" as read on
                # Wednesday. Escalation is news; a new key is how news arrives
                # unread.
                "id": f"{'out' if out else 'low'}:{it.id}",
                "kind": "out_of_stock" if out else "low_stock",
                "stream": "alert",
                "area": "stock",
                "severity": "danger" if out else "warn",
                "icon": "⛔" if out else "📦",
                "title": f"{'Out of stock' if out else 'Low stock'} — {it.name}",
                "body": body,
                "route": "/purchasing",
                "at": None,
                "who": "",
            })

    # Recent activity — the audit trail, filtered to areas the user may see.
    can_users = can("users:read")
    shown = 0
    for ev in await audit_service.list_events(db, user.hotel_id, limit=100):
        icon, title, route, perm = _activity_meta(ev.action)
        if perm is None:
            if not can_users:
                continue
        elif not can(perm):
            continue
        area = pipeline.area_for_action(ev.action)
        items.append({
            "id": f"act:{ev.id}",
            "kind": ev.action,
            "stream": "activity",
            "area": area,
            "severity": "info",
            "icon": icon,
            "title": title,
            "body": ev.summary,
            # A row with no page of its own opens its area's page rather than
            # nothing — every row is a door.
            "route": route or pipeline.AREA_BY_KEY[area].route,
            "at": ev.created_at.isoformat(),
            "who": ev.user_email or "",
            # You did it, so you know. Your own actions arrive already read;
            # otherwise the busiest person in the building has the noisiest bell.
            "read": ev.user_id is not None and ev.user_id == user.id,
        })
        shown += 1
        if shown >= 40:
            break

    # ── FOR YOU ───────────────────────────────────────────────────────────
    #
    # Addressed to this person, and therefore NOT permission-gated: you always
    # see what was asked of you. Everything here is read from rows the features
    # already write, so there is no second source of truth to drift.
    me = (
        await db.execute(
            select(Employee).where(
                Employee.hotel_id == user.hotel_id,
                Employee.user_id == user.id,
            )
        )
    ).scalar_one_or_none()

    if me is not None:
        # Documents somebody has asked YOU for, oldest first — the one waiting
        # longest is the one that matters.
        pending = (
            (
                await db.execute(
                    select(DocumentRequest)
                    .where(
                        DocumentRequest.hotel_id == user.hotel_id,
                        DocumentRequest.employee_id == me.id,
                        DocumentRequest.status == DocRequestStatus.PENDING.value,
                    )
                    .order_by(DocumentRequest.created_at)
                    .limit(20)
                )
            )
            .scalars()
            .all()
        )
        for r in pending:
            waited = (datetime.now(UTC) - r.created_at).days if r.created_at else 0
            items.append({
                "id": f"docreq:{r.id}",
                "kind": "document_requested",
                "stream": "mine",
                "area": "mine",
                "severity": "warn" if waited >= 7 else "info",
                "icon": "📄",
                "title": f"{r.title} was asked of you",
                # Days, not a raw timestamp — "asked 9 days ago" is the fact.
                "body": (
                    "asked just now" if waited < 1
                    else "asked yesterday" if waited == 1
                    else f"asked {waited} days ago"
                ),
                "route": "/my",
                "at": r.created_at.isoformat() if r.created_at else None,
                "who": "",
            })

        # YOUR shifts, from today forward. Past shifts are history, not news —
        # telling somebody on Friday that they were on the rota on Tuesday is
        # noise, and noise is exactly what buries the document request above.
        shifts = (
            (
                await db.execute(
                    select(Shift)
                    .where(
                        Shift.hotel_id == user.hotel_id,
                        Shift.employee_id == me.id,
                        Shift.date >= date.today(),
                        # THREE DAYS, not fourteen.
                        #
                        # I built this stream so a document request could not be
                        # buried, and then made it the thing most able to bury:
                        # a fortnight of rota is up to twenty rows sitting above
                        # the out-of-stock alert. What somebody needs from a
                        # BELL is "am I on tonight" — the fortnight is what the
                        # Rota tab is for, and it now carries its own +N badge.
                        Shift.date <= date.today() + timedelta(days=3),
                    )
                    .order_by(Shift.date, Shift.start_time)
                    .limit(6)
                )
            )
            .scalars()
            .all()
        )
        for s in shifts:
            days = (s.date - date.today()).days
            when = (
                "today" if days == 0
                else "tomorrow" if days == 1
                else s.date.strftime("%a %d %b")
            )
            items.append({
                "id": f"shift:{s.id}",
                "kind": "rota_shift",
                "stream": "mine",
                "area": "mine",
                "severity": "info",
                "icon": "🗓️",
                "title": f"You are on the rota {when}",
                "body": f"{s.start_time.strftime('%H:%M')}–{s.end_time.strftime('%H:%M')}",
                "route": "/my",
                "at": None,
                "who": "",
            })

    return items


# ── SHAPE + STATE ──────────────────────────────────────────────────────────


async def _respond(db: AsyncSession, user: User, items: list[dict]) -> dict:
    marks = await state_service.load(db, user)
    shaped = pipeline.run(items, marks)

    # ── The old shape, for clients that loaded before this deploy. ──────────
    #
    # A kitchen tablet left on one page never navigates, so it keeps the old
    # bundle — and the old bell reads these three lists. Kept for one release:
    # cheap, and the alternative is a bell that silently reads "all caught up"
    # on the one screen nobody refreshes.
    #
    # DANGER OUTRANKS WARNING here too — the sort that fixed the out-of-stock
    # sitting ninth under eight price rises on production.
    put_away = {k for k, m in marks.items() if m.dismissed}
    legacy = [
        {**i, "read": bool(i.get("read")) or marks.get(i["id"], pipeline.Mark()).read}
        for i in items
        if i["id"] not in put_away or i.get("severity") == pipeline.DANGER
    ]
    alerts = sorted(
        (i for i in legacy if i["stream"] == "alert"),
        key=lambda a: pipeline.rank(a.get("severity")),
    )
    activity = [i for i in legacy if i["stream"] == "activity"]
    mine = [i for i in legacy if i["stream"] == "mine"]

    return {
        "version": 2,
        "generated_at": datetime.now(UTC).isoformat(),
        **shaped,
        "alerts": alerts,
        "activity": activity,
        "mine": mine,
        # `mine` is counted FIRST and separately: a thing asked of you
        # personally must not be buried by forty sales rows, which is 32.12's
        # complaint in miniature.
        "mine_count": len(mine),
        "items": alerts,
        "count": len(legacy),
    }


def _refuse_support_view(user: User) -> None:
    """An operator's "view as" is read-only — and here that is not a formality.

    The support token carries the hotel ADMIN's identity, so a "mark all read"
    pressed while looking around would clear the OWNER's bell: he would never
    see the alerts the operator skimmed past. Every other write refuses an
    impersonated session through `require()`; these endpoints need no
    permission, so they have to say it themselves.
    """
    if getattr(user, "is_impersonated_session", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Read-only support view - changes are disabled while impersonating.",
        )


def _known(items: list[dict], keys: list[str]) -> list[str]:
    """Only keys this person's own feed emitted right now.

    A key is opaque, so without this anybody signed in could write rows for
    strings that were never notifications — unbounded, one request at a time.
    It also means a key copied from another restaurant's bell writes nothing.
    And it is what makes the one-off localStorage migration cheap: a browser's
    old seen-set is mostly audit events long gone, and those are dropped here
    instead of becoming dead rows.
    """
    ids = {i["id"] for i in items}
    return [k for k in keys if k in ids]


class KeysIn(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=500)


class ReadAllIn(BaseModel):
    #: One box ("mark these read"), or everything when absent.
    area: str | None = Field(default=None, max_length=40)


class MuteIn(BaseModel):
    area: str = Field(min_length=1, max_length=40)
    muted: bool = True


@router.get("")
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """The bell: alerts, activity and For-you, grouped by area, with this
    person's read and dismissed state applied."""
    return await _respond(db, user, await _build(db, user))


@router.post("/read")
async def mark_read(
    payload: KeysIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Mark these read — on every device this person uses, not just this one."""
    _refuse_support_view(user)
    items = await _build(db, user)
    live = {i["id"] for i in items}
    await state_service.write(db, user, _known(items, payload.keys), live=live, read=True)
    return await _respond(db, user, items)


@router.post("/unread")
async def mark_unread(
    payload: KeysIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Put the dot back — "I'll come back to this one"."""
    _refuse_support_view(user)
    items = await _build(db, user)
    live = {i["id"] for i in items}
    await state_service.write(db, user, _known(items, payload.keys), live=live, read=False)
    return await _respond(db, user, items)


@router.post("/read-all")
async def mark_all_read(
    payload: ReadAllIn | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Everything in the feed (or in one area's box) read, and it STAYS read.

    Computed here rather than sent by the client, because the client cannot
    see the rows CAP held back — a mark-all that cleared only what was on
    screen would leave the badge at 38 with nothing left to click.
    """
    _refuse_support_view(user)
    area = payload.area if payload else None
    items = await _build(db, user)
    live = {i["id"] for i in items}
    keys = [i["id"] for i in items if area is None or i["area"] == area]
    await state_service.write(db, user, keys, live=live, read=True)
    return await _respond(db, user, items)


@router.post("/dismiss")
async def dismiss(
    payload: KeysIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Put these away. Danger is refused silently — see `pipeline.apply_marks`."""
    _refuse_support_view(user)
    items = await _build(db, user)
    live = {i["id"] for i in items}
    danger = {i["id"] for i in items if i.get("severity") == pipeline.DANGER}
    keys = [k for k in _known(items, payload.keys) if k not in danger]
    await state_service.write(db, user, keys, live=live, dismissed=True)
    return await _respond(db, user, items)


@router.post("/undismiss")
async def undismiss(
    payload: KeysIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """The undo for a dismiss, and the way back from the "put away" list."""
    _refuse_support_view(user)
    items = await _build(db, user)
    live = {i["id"] for i in items}
    await state_service.write(db, user, _known(items, payload.keys), live=live, dismissed=False)
    return await _respond(db, user, items)


@router.post("/mute")
async def mute_area(
    payload: MuteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Silence one noisy area — 32.12 handed to the person it bothers.

    Its danger rows still show (a mute is not allowed to hide an out-of-stock),
    and For you cannot be muted at all: you always see what was asked of you.
    """
    _refuse_support_view(user)
    if payload.area not in pipeline.AREA_BY_KEY or payload.area == "mine":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That area cannot be muted")
    items = await _build(db, user)
    live = {i["id"] for i in items}
    await state_service.write(
        db, user, [pipeline.mute_key(payload.area)], live=live, dismissed=payload.muted
    )
    return await _respond(db, user, items)
