"""In-app notifications — a lightweight aggregator of what the user should know
right now. Two streams, both computed on the fly and strictly hotel-scoped:

  • ALERTS   — actionable states needing attention: supplier PRICE RISES + LOW/OUT
               of stock.
  • ACTIVITY — a live feed of everything happening in the business (sales, waste,
               deliveries, payroll, shifts, expenses, price changes…), read straight
               from the audit log so the bell doubles as a "recent history".

No storage: the header bell polls this and tracks 'seen' client-side. Every item is
permission-gated so a user only sees streams for areas they can access."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit_service
from app.auth.deps import get_current_user
from app.auth.models import User
from app.core.database import get_db
from app.core.rbac import has_permission
from app.inventory import service as inv_service
from app.reports import insights

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

    # `items` kept for backward-compat (older clients); `count` badges the bell.
    return {
        "alerts": alerts,
        "activity": activity,
        "items": alerts,
        "count": len(alerts) + len(activity),
    }
