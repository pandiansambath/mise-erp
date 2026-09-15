"""In-app notifications — a lightweight aggregator of what the user should know
right now. Two streams, both computed on the fly and strictly hotel-scoped:

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

No storage: the header bell polls this and tracks 'seen' client-side. Every item is
permission-gated so a user only sees streams for areas they can access."""
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit_service
from app.auth.deps import get_current_user
from app.auth.models import User
from app.core.database import get_db
from app.core.rbac import has_permission
from app.documents.models import DocRequestStatus, DocumentRequest
from app.employees.models import Employee
from app.inventory import service as inv_service
from app.reports import insights
from app.rota.models import Shift

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Exact action → (icon, friendly title, route, permission required to SEE it).
_ACTIVITY: dict[str, tuple[str, str, str, str]] = {
    "sale.add": ("🧾", "Sales recorded", "/sales", "sales:read"),
    "expense.add": ("💸", "Expense added", "/expenses", "expenses:read"),
    "expense.delete": ("💸", "Expense removed", "/expenses", "expenses:read"),
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


@router.get("")
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Alerts (price rises + low stock) and the recent activity feed for this hotel."""
    alerts: list[dict] = []

    # Supplier price rises — only if the user can see costs/inventory. Newest first.
    if has_permission(user.role, "inventory:read") or has_permission(user.role, "reports:read"):
        rises = sorted(
            await insights.price_alerts(db, user.hotel_id),
            key=lambda a: a["last_ordered"], reverse=True,
        )
        for a in rises:
            vendor = a.get("vendor_name") or "a supplier"
            body = f"{vendor}: £{a['prev_price']} → £{a['latest_price']} (+{a['change_pct']}%)"
            alerts.append({
                "id": f"price:{a['item_id']}:{a['latest_price']}",
                "kind": "price_rise",
                "severity": "warn",
                "icon": "📈",
                "title": f"Price up — {a['item_name']}",
                "body": body,
                "route": "/price-comparison",
            })

    # Low / out of stock.
    if has_permission(user.role, "inventory:read"):
        for it in (await inv_service.low_stock_items(db, user.hotel_id))[:15]:
            qty = it.current_stock
            out = qty is not None and qty <= 0
            minlvl = it.min_stock_level
            body = f"{qty} {it.unit} left" + (f" (min {minlvl})" if minlvl is not None else "")
            alerts.append({
                "id": f"low:{it.id}",
                "kind": "out_of_stock" if out else "low_stock",
                "severity": "danger" if out else "warn",
                "icon": "⛔" if out else "📦",
                "title": f"{'Out of stock' if out else 'Low stock'} — {it.name}",
                "body": body,
                "route": "/purchasing",
            })

    # Recent activity — the audit trail, filtered to areas the user may see.
    activity: list[dict] = []
    can_users = has_permission(user.role, "users:read")
    for ev in await audit_service.list_events(db, user.hotel_id, limit=60):
        icon, title, route, perm = _activity_meta(ev.action)
        if perm is None:
            if not can_users:
                continue
        elif not has_permission(user.role, perm):
            continue
        activity.append({
            "id": f"act:{ev.id}",
            "kind": ev.action,
            "icon": icon,
            "title": title,
            "body": ev.summary,
            "route": route,
            "at": ev.created_at.isoformat(),
            "who": ev.user_email or "",
        })
        if len(activity) >= 25:
            break

    # ── FOR YOU ───────────────────────────────────────────────────────────
    #
    # Addressed to this person, and therefore NOT permission-gated: you always
    # see what was asked of you. Everything here is read from rows the features
    # already write, so there is no second source of truth to drift.
    mine: list[dict] = []
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
            mine.append({
                "id": f"docreq:{r.id}",
                "kind": "document_requested",
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
            mine.append({
                "id": f"shift:{s.id}",
                "kind": "rota_shift",
                "severity": "info",
                "icon": "🗓️",
                "title": f"You are on the rota {when}",
                "body": f"{s.start_time.strftime('%H:%M')}–{s.end_time.strftime('%H:%M')}",
                "route": "/my",
                "at": None,
            })

    # ── DANGER OUTRANKS WARNING. ───────────────────────────────────────────
    #
    #     "if I get so many notifications from one area, the important one from
    #      another area is buried."
    #
    # Half of that was a plain ordering bug rather than anything subtle. Alerts
    # were built price-rises-first and then low stock, so an OUT OF STOCK —
    # severity danger — sat underneath ten price rises inside the same section.
    # The empty chicken bin was literally below "flour went up 6%".
    #
    # Sorted by severity now, and stably: equal severities keep the order they
    # were built in, so rows do not shuffle under the cursor between polls.
    _SEV = {"danger": 0, "warn": 1, "info": 2}
    alerts.sort(key=lambda a: _SEV.get(a.get("severity", "info"), 2))

    # `items` kept for backward-compat (older clients); `count` badges the bell.
    #
    # `mine` is counted FIRST and separately: a thing asked of you personally
    # must not be buried by forty sales rows, which is 32.12's complaint in
    # miniature. The client badges `count`; `mine_count` lets the Rota and My
    # sections carry their own +1/+2/+3 without re-deriving it.
    return {
        "alerts": alerts,
        "activity": activity,
        "mine": mine,
        "mine_count": len(mine),
        "items": alerts,
        "count": len(mine) + len(alerts) + len(activity),
    }
