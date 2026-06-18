"""What the Copilot can DO — tools the model may call to read live data or to
produce navigation. Every tool runs server-side, scoped to the caller's hotel
and permissions, so the assistant can never read another tenant's data.

Each executor returns a plain JSON-able dict (fed back to the model). It may
include an ``actions`` list of {label, href} — these are surfaced to the UI as
clickable buttons/links AND shown to the model so it can reference them.
"""
from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.rbac import has_permission
from app.inventory import service as inventory_service
from app.reports import service as reports_service

from .knowledge import PAGES, glossary_lookup

Executor = Callable[[AsyncSession, User, dict], Coroutine[Any, Any, dict]]


def _s(v: Any) -> str | None:
    return None if v is None else str(v)


def _can(user: User):
    return lambda perm: has_permission(user.role, perm)


# ── Tool implementations ──────────────────────────────────────────────────────
async def search_items(db: AsyncSession, user: User, args: dict) -> dict:
    """Find stock items by (partial) name and report stock + cost + whether low."""
    if not has_permission(user.role, "inventory:read"):
        return {"error": "You don't have access to inventory."}
    query = (args.get("query") or "").strip().lower()
    items = await inventory_service.list_items(db, user.hotel_id)
    matches = [i for i in items if query in i.name.lower()] if query else items
    matches = matches[:8]
    if not matches:
        return {"matches": [], "note": f"No stock item matches '{query}'."}
    rows = []
    for i in matches:
        minlvl = i.min_stock_level
        low = minlvl is not None and i.current_stock <= minlvl
        rows.append({
            "name": i.name,
            "current_stock": _s(i.current_stock),
            "unit": i.unit,
            "average_cost": _s(i.average_cost),
            "min_level": _s(minlvl),
            "is_low": low,
            "orderable": (i.vendor_count or 0) > 0,
        })
    actions = [{"label": "Open Inventory", "href": "/inventory"}]
    if any(r["is_low"] for r in rows):
        actions.append({"label": "Reorder on Purchasing", "href": "/purchasing"})
    return {"matches": rows, "actions": actions}


async def low_stock(db: AsyncSession, user: User, args: dict) -> dict:
    """List items at or below their reorder level — what needs buying."""
    if not has_permission(user.role, "inventory:read"):
        return {"error": "You don't have access to inventory."}
    items = await inventory_service.low_stock_items(db, user.hotel_id)
    rows = [{
        "name": i.name,
        "current_stock": _s(i.current_stock),
        "min_level": _s(i.min_stock_level),
        "unit": i.unit,
    } for i in items]
    actions = []
    if rows:
        actions.append({"label": "Reorder on Purchasing", "href": "/purchasing"})
    actions.append({"label": "Open Inventory", "href": "/inventory"})
    return {"low_stock_count": len(rows), "items": rows, "actions": actions}


async def money_snapshot(db: AsyncSession, user: User, args: dict) -> dict:
    """Today's and this month's headline numbers — sales, profit, margin."""
    if not has_permission(user.role, "reports:read"):
        return {"error": "You don't have access to financial reports."}
    k = await reports_service.dashboard(db, user.hotel_id)
    return {
        "today_net_sales": _s(k["today_net_sales"]),
        "month_net_sales": _s(k["month_net_sales"]),
        "month_expenses": _s(k["month_expenses"]),
        "month_net_profit": _s(k["month_net_profit"]),
        "month_net_margin_pct": _s(k["month_net_margin_pct"]),
        "low_stock_count": k["low_stock_count"],
        "avg_recipe_margin_pct": _s(k["avg_recipe_margin_pct"]),
        "actions": [
            {"label": "Open Money", "href": "/money"},
            {"label": "Open Reports (P&L)", "href": "/reports"},
        ],
    }


async def navigate(db: AsyncSession, user: User, args: dict) -> dict:
    """Resolve a free-text intent ('reorder', 'where do I add a supplier') to the
    best Mise page the user can reach, with a direct link."""
    q = (args.get("query") or "").strip().lower()
    can = _can(user)
    visible = [p for p in PAGES if not p["perm"] or can(p["perm"])]
    # crude relevance: score by keyword overlap with label + about
    def score(p: dict) -> int:
        hay = f"{p['label']} {p['about']} {p['route']}".lower()
        return sum(1 for w in q.split() if w and w in hay)
    ranked = sorted(visible, key=score, reverse=True)
    best = [p for p in ranked if score(p) > 0][:3]
    if not best:
        return {"note": "No specific page matched; suggest the Dashboard.",
                "actions": [{"label": "Open Dashboard", "href": "/dashboard"}]}
    return {
        "pages": [{"label": p["label"], "route": p["route"], "about": p["about"]} for p in best],
        "actions": [{"label": f"Open {p['label']}", "href": p["route"]} for p in best],
    }


async def explain_term(db: AsyncSession, user: User, args: dict) -> dict:
    """Define a Mise / restaurant-finance term in plain English."""
    term = (args.get("term") or "").strip()
    definition = glossary_lookup(term)
    return {
        "term": term,
        "definition": definition
        or "No glossary entry; answer from general knowledge but stay honest.",
    }


# ── Registry: schema (for the model) + executor (server-side) ─────────────────
_QUERY = {"type": "string"}
TOOLS: list[dict] = [
    {
        "name": "search_items",
        "description": (
            "Look up one or more stock items by name to report current quantity, "
            "average cost, and whether they're low. Use for 'how much X do I have', "
            "'is X low', 'cost of X'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {**_QUERY, "description": "Item name or part of it, e.g. 'tomato'"}
            },
            "required": ["query"],
        },
    },
    {
        "name": "low_stock",
        "description": (
            "List every item at or below its reorder level — i.e. what needs buying "
            "now. Use for 'what's low', 'what's running out', 'what should I order'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "money_snapshot",
        "description": (
            "Get today's and this month's headline figures: net sales, net profit, "
            "net margin %, low-stock count, average dish margin. Use for 'how are we "
            "doing', 'today's sales', 'this month's profit'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "navigate",
        "description": (
            "Find the right Mise page for what the user wants to do, and return a "
            "direct link. Use for 'where do I…', 'how do I…', 'take me to…'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    **_QUERY,
                    "description": "What the user wants to do, e.g. 'reorder paneer'",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "explain_term",
        "description": (
            "Define a restaurant-finance or Mise term (e.g. 'slow stock', 'food cost "
            "variance', 'margin', 'break even')."
        ),
        "parameters": {
            "type": "object",
            "properties": {"term": {"type": "string"}},
            "required": ["term"],
        },
    },
]

EXECUTORS: dict[str, Executor] = {
    "search_items": search_items,
    "low_stock": low_stock,
    "money_snapshot": money_snapshot,
    "navigate": navigate,
    "explain_term": explain_term,
}
