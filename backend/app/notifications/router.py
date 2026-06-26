"""In-app notifications — a lightweight aggregator of things the user should know
right now: supplier PRICE RISES and LOW STOCK. Computed on the fly from existing
data, strictly hotel-scoped (uses the signed-in user's hotel). No storage: the
header bell polls this and tracks 'seen' client-side. Permission-aware so a user
only sees alerts for areas they can access."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.models import User
from app.core.database import get_db
from app.core.rbac import has_permission
from app.inventory import service as inv_service
from app.reports import insights

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Current alerts for this hotel: price rises (what you actually paid is
    climbing) + low stock. Returns a flat list the bell renders, newest concerns
    first, with a total count for the badge."""
    items: list[dict] = []

    # Supplier price rises — only if the user can see costs/inventory.
    if has_permission(user.role, "inventory:read") or has_permission(user.role, "reports:read"):
        for a in await insights.price_alerts(db, user.hotel_id):
            vendor = a.get("vendor_name") or "a supplier"
            body = f"{vendor}: £{a['prev_price']} → £{a['latest_price']} (+{a['change_pct']}%)"
            items.append({
                "id": f"price:{a['item_id']}:{a['latest_price']}",
                "kind": "price_rise",
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
            items.append({
                "id": f"low:{it.id}",
                "kind": "out_of_stock" if out else "low_stock",
                "icon": "⛔" if out else "📦",
                "title": f"{'Out of stock' if out else 'Low stock'} — {it.name}",
                "body": body,
                "route": "/purchasing",
            })

    return {"items": items, "count": len(items)}
