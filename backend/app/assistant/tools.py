"""What the Copilot can DO — tools the model may call to read live data or to
produce navigation. Every tool runs server-side, scoped to the caller's hotel
and permissions, so the assistant can never read another tenant's data.

Each executor returns a plain JSON-able dict (fed back to the model). It may
include an ``actions`` list of {label, href} — these are surfaced to the UI as
clickable buttons/links AND shown to the model so it can reference them.
"""
from __future__ import annotations

from collections.abc import Callable, Coroutine
from datetime import date as date_type
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.rbac import has_permission
from app.expenses import service as expense_service
from app.inventory import service as inventory_service
from app.recipes import service as recipe_service
from app.reports import service as reports_service
from app.sales import service as sales_service
from app.vendors import service as vendor_service

from . import actions as action_mod
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


async def business_overview(db: AsyncSession, user: User, args: dict) -> dict:
    """Exact totals across the business — how many recipes, stock items, suppliers,
    and how many items are low. Use for any 'how many X do I have' question."""
    out: dict = {}
    if has_permission(user.role, "recipes:read"):
        out["recipe_count"] = len(await recipe_service.list_recipes(db, user.hotel_id))
    if has_permission(user.role, "inventory:read"):
        out["item_count"] = len(await inventory_service.list_items(db, user.hotel_id))
        out["low_stock_count"] = len(await inventory_service.low_stock_items(db, user.hotel_id))
    if has_permission(user.role, "vendors:read"):
        out["vendor_count"] = len(await vendor_service.list_vendors(db, user.hotel_id))
    return out or {"note": "You don't have read access to those areas."}


async def list_recipes(db: AsyncSession, user: User, args: dict) -> dict:
    """The actual recipes (name + margin), and the exact count. Use for 'list my
    recipes', 'how many recipes', 'which dishes have thin margins'."""
    if not has_permission(user.role, "recipes:read"):
        return {"error": "You don't have access to recipes."}
    recipes = await recipe_service.list_recipes(db, user.hotel_id)
    rows = [{
        "name": r.name,
        "margin_pct": _s(r.profit_margin),
        "selling_price": _s(r.selling_price),
    } for r in recipes[:60]]
    return {
        "recipe_count": len(recipes),
        "recipes": rows,
        "actions": [{"label": "Open Recipes", "href": "/recipes"}],
    }


async def stock_value(db: AsyncSession, user: User, args: dict) -> dict:
    """Total money tied up in stock (weighted-average cost), broken down by category."""
    if not has_permission(user.role, "inventory:read"):
        return {"error": "You don't have access to inventory."}
    items = await inventory_service.list_items(db, user.hotel_id)
    by_cat: dict[str, Decimal] = {}
    total = Decimal("0")
    for i in items:
        val = (i.current_stock or Decimal("0")) * (i.average_cost or Decimal("0"))
        total += val
        cat = i.category or "Uncategorised"
        by_cat[cat] = by_cat.get(cat, Decimal("0")) + val
    q = Decimal("0.01")
    return {
        "total_stock_value": _s(total.quantize(q)),
        "item_count": len(items),
        "by_category": [
            {"category": k, "value": _s(v.quantize(q))}
            for k, v in sorted(by_cat.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "actions": [{"label": "Open Inventory", "href": "/inventory"}],
    }


async def list_vendors(db: AsyncSession, user: User, args: dict) -> dict:
    """The suppliers (name + what they supply) and the exact count."""
    if not has_permission(user.role, "vendors:read"):
        return {"error": "You don't have access to suppliers."}
    vendors = await vendor_service.list_vendors(db, user.hotel_id)
    rows = [{"name": v.name, "category": v.category} for v in vendors[:60]]
    return {"vendor_count": len(vendors), "vendors": rows,
            "actions": [{"label": "Open Vendors", "href": "/vendors"}]}


async def expenses_summary(db: AsyncSession, user: User, args: dict) -> dict:
    """This month's expenses: total, fixed vs variable, and top categories."""
    if not has_permission(user.role, "expenses:read"):
        return {"error": "You don't have access to expenses."}
    today = date_type.today()
    s = await expense_service.summary(db, user.hotel_id, today.replace(day=1), today)
    return {
        "period": "this month",
        "total": _s(s["grand_total"]),
        "fixed": _s(s["fixed_total"]),
        "variable": _s(s["variable_total"]),
        "top_categories": [
            {"category": c["category_name"], "total": _s(c["total"])} for c in s["by_category"][:6]
        ],
        "actions": [{"label": "Open Expenses", "href": "/expenses"}],
    }


async def sales_summary(db: AsyncSession, user: User, args: dict) -> dict:
    """This month's sales: gross, delivery commission, and net takings."""
    if not has_permission(user.role, "sales:read"):
        return {"error": "You don't have access to sales."}
    today = date_type.today()
    r = await sales_service.range_summary(db, user.hotel_id, today.replace(day=1), today)
    return {"period": "this month", "gross": _s(r["gross"]), "commission": _s(r["commission"]),
            "net": _s(r["net"]), "actions": [{"label": "Open Sales & Cash", "href": "/sales"}]}


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


# ── Write proposals (never execute here; the user confirms in the UI) ─────────
async def _propose(kind: str, user: User, args: dict) -> dict:
    spec = action_mod.SPECS[kind]
    if not has_permission(user.role, spec["perm"]):
        return {"error": f"You don't have permission to add a {spec['label']}."}
    p = action_mod.build_proposal(kind, args or {})
    if not p.get("ok"):
        if p.get("missing"):
            return {"need_more": p["missing"],
                    "note": f"Ask the user for {', '.join(p['missing'])} before proposing."}
        return {"error": p.get("error", "Could not build that action.")}
    # 'proposal' is harvested by the service into pending_actions (the confirm card)
    return {"proposed": p["summary"],
            "proposal": {"kind": p["kind"], "label": p["label"],
                         "summary": p["summary"], "fields": p["fields"]}}


async def propose_expense(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("expense", user, args)


async def propose_sale(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("sale", user, args)


async def propose_item(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("item", user, args)


async def propose_vendor(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("vendor", user, args)


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
        "name": "business_overview",
        "description": (
            "Exact totals: how many recipes, stock items, suppliers, and how many "
            "items are low. ALWAYS use this for any 'how many X' / counts question — "
            "never estimate a count yourself."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "list_recipes",
        "description": (
            "The actual list of recipes (name + margin) and the exact recipe count. "
            "Use for 'list/show my recipes', 'how many recipes', 'thinnest margins'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "stock_value",
        "description": (
            "Total money tied up in stock (at weighted-average cost), by category. "
            "Use for 'what's my stock worth', 'inventory value'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "list_vendors",
        "description": "The suppliers (name + category) and the exact supplier count.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "expenses_summary",
        "description": (
            "This month's expenses: total, fixed vs variable, and top categories. "
            "Use for 'what did I spend this month', 'my costs'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "sales_summary",
        "description": (
            "This month's sales: gross, delivery commission and net takings. Use for "
            "'this month's sales/takings'."
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
    # ── Write proposals — gather every required field (ASK if missing) before
    # calling these. They DON'T save; they raise a confirmation card for the user.
    {
        "name": "propose_expense",
        "description": (
            "Propose recording a business expense (e.g. a bill, a utility, a purchase). "
            "Gather the amount first; category/date/description are helpful. Does not "
            "save until the user confirms."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "amount": {"type": "number", "description": "Total amount in £"},
                "category": {"type": "string", "description": "e.g. Utilities, Rent, Food"},
                "description": {"type": "string"},
                "date": {"type": "string", "description": "YYYY-MM-DD, or 'today'/'yesterday'"},
                "kind": {"type": "string", "description": "fixed or variable"},
                "payment_method": {"type": "string", "description": "CASH, CARD or BANK"},
            },
            "required": ["amount"],
        },
    },
    {
        "name": "propose_sale",
        "description": (
            "Propose recording a sale / takings (e.g. from a delivery app or the till). "
            "Gather the amount; channel/date help. Does not save until confirmed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "amount": {"type": "number", "description": "Gross sale amount in £"},
                "channel": {"type": "string", "description": "e.g. Dine-in, Just Eat, Uber Eats"},
                "date": {"type": "string", "description": "YYYY-MM-DD, or 'today'/'yesterday'"},
                "payment_method": {"type": "string", "description": "CASH or CARD"},
            },
            "required": ["amount"],
        },
    },
    {
        "name": "propose_item",
        "description": (
            "Propose adding ONE stock item. Needs name + unit. Saves only on confirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "unit": {"type": "string", "description": "kg, g, l, ml, each, pack…"},
                "category": {"type": "string"},
                "current_stock": {"type": "number"},
                "cost_price": {"type": "number", "description": "cost per unit in £"},
            },
            "required": ["name", "unit"],
        },
    },
    {
        "name": "propose_vendor",
        "description": "Propose adding ONE supplier. Needs a name. Does not save until confirmed.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "category": {"type": "string", "description": "what they supply"},
                "contact_person": {"type": "string"},
                "mobile": {"type": "string"},
                "email": {"type": "string"},
            },
            "required": ["name"],
        },
    },
]

EXECUTORS: dict[str, Executor] = {
    "search_items": search_items,
    "low_stock": low_stock,
    "money_snapshot": money_snapshot,
    "business_overview": business_overview,
    "list_recipes": list_recipes,
    "stock_value": stock_value,
    "list_vendors": list_vendors,
    "expenses_summary": expenses_summary,
    "sales_summary": sales_summary,
    "navigate": navigate,
    "explain_term": explain_term,
    "propose_expense": propose_expense,
    "propose_sale": propose_sale,
    "propose_item": propose_item,
    "propose_vendor": propose_vendor,
}

# Tools gated by a write permission — filtered out for roles that lack it so the
# model is never even offered an action the user can't take.
TOOL_PERMS: dict[str, str] = {
    "propose_expense": "expenses:write",
    "propose_sale": "sales:write",
    "propose_item": "inventory:write",
    "propose_vendor": "vendors:write",
}


def tools_for(user: User) -> list[dict]:
    """The tool schemas this user's role may use."""
    return [
        t for t in TOOLS
        if t["name"] not in TOOL_PERMS or has_permission(user.role, TOOL_PERMS[t["name"]])
    ]
