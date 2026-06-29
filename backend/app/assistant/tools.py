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


def _d(v: Any, fallback: date_type) -> date_type:
    try:
        return date_type.fromisoformat(str(v)[:10])
    except (ValueError, TypeError):
        return fallback


async def item_detail(db: AsyncSession, user: User, args: dict) -> dict:
    """One stock item in full: stock on hand, weighted-average cost, stock value, min
    level, and the suppliers that price it (cheapest + chosen ★)."""
    if not has_permission(user.role, "inventory:read"):
        return {"error": "You don't have access to inventory."}
    name = (args.get("name") or "").strip()
    if not name:
        return {"error": "Which item?"}
    item = await inventory_service.get_item_by_name(db, user.hotel_id, name)
    if item is None:
        items = await inventory_service.list_items(db, user.hotel_id)
        item = next((i for i in items if name.lower() in (i.name or "").lower()), None)
    if item is None:
        return {"note": f"No stock item matches '{name}'."}
    zero = Decimal("0")
    value = ((item.current_stock or zero) * (item.average_cost or zero)).quantize(Decimal("0.01"))
    suppliers: list[dict] = []
    if has_permission(user.role, "vendors:read"):
        cmp = await vendor_service.compare_vendor_prices(db, item.id, user.hotel_id)
        if cmp and cmp.get("vendors"):
            suppliers = [
                {"vendor": v["vendor_name"], "price": _s(v["price_per_unit"]),
                 "chosen": bool(v.get("is_preferred"))}
                for v in cmp["vendors"][:8]
            ]
    return {
        "name": item.name, "category": item.category, "unit": item.unit,
        "in_stock": _s(item.current_stock), "min_level": _s(item.min_stock_level),
        "average_cost": _s(item.average_cost), "stock_value": _s(value),
        "suppliers": suppliers,
        "actions": [{"label": "Open Inventory", "href": "/inventory"}],
    }


async def recipe_detail(db: AsyncSession, user: User, args: dict) -> dict:
    """One dish in full: cost per serving, selling price, profit margin and the
    ingredient breakdown."""
    if not has_permission(user.role, "recipes:read"):
        return {"error": "You don't have access to recipes."}
    name = (args.get("name") or "").strip()
    if not name:
        return {"error": "Which dish?"}
    recipes = await recipe_service.list_recipes(db, user.hotel_id)
    rec = next((r for r in recipes if name.lower() in (r.name or "").lower()), None)
    if rec is None:
        return {"note": f"No dish matches '{name}'."}
    cost = await recipe_service.calculate_recipe_cost(db, rec.id, user.hotel_id)
    if cost is None:
        return {"name": rec.name, "note": "No cost breakdown available."}
    ings = [
        {"item": b["item_name"], "qty": _s(b["quantity"]), "unit": b.get("unit"),
         "line_cost": _s(b["line_cost"])}
        for b in cost.get("ingredients", [])[:25]
    ]
    return {
        "name": cost["recipe_name"],
        "cost_per_serving": _s(cost["cost_per_serving"]),
        "selling_price": _s(cost["selling_price"]),
        "margin_pct": _s(cost["profit_margin_pct"]),
        "missing_prices": cost["has_missing_prices"],
        "ingredients": ings,
        "actions": [{"label": "Open Recipes", "href": "/recipes"}],
    }


async def profit_for_range(db: AsyncSession, user: User, args: dict) -> dict:
    """Profit & loss for a date range (defaults to this month)."""
    if not has_permission(user.role, "reports:read"):
        return {"error": "You don't have access to reports."}
    today = date_type.today()
    dt = _d(args.get("date_to"), today)
    df = _d(args.get("date_from"), today.replace(day=1))
    r = await reports_service.pnl(db, user.hotel_id, df, dt)
    return {
        "date_from": str(df), "date_to": str(dt),
        "net_sales": _s(r["net_sales"]), "cost_of_sales": _s(r["cost_of_sales"]),
        "gross_profit": _s(r["gross_profit"]), "operating_expenses": _s(r["operating_expenses"]),
        "net_profit": _s(r["net_profit"]), "net_margin_pct": _s(r["net_margin_pct"]),
        "actions": [{"label": "Open Reports", "href": "/reports"}],
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


async def propose_employee(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("employee", user, args)


async def propose_waste(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("waste", user, args)


async def propose_set_supplier(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("set_supplier", user, args)


async def propose_vendor_price(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("vendor_price", user, args)


async def propose_stock_count(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("stock_count", user, args)


async def propose_recipe(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("recipe", user, args)


async def propose_recipe_ingredients(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("recipe_ingredients", user, args)


async def propose_purchase(db: AsyncSession, user: User, args: dict) -> dict:
    return await _propose("purchase", user, args)


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
    {
        "name": "item_detail",
        "description": (
            "Full detail on ONE stock item: stock on hand, weighted-avg cost, stock "
            "value, min level, and its suppliers (cheapest + chosen ★). Use for 'tell "
            "me about <item>', 'how much <item> do I have', 'who supplies <item>'."
        ),
        "parameters": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "recipe_detail",
        "description": (
            "Full detail on ONE dish: cost per serving, selling price, profit margin and "
            "the ingredient breakdown. Use for 'margin on <dish>', 'what does <dish> "
            "cost', 'is <dish> profitable'."
        ),
        "parameters": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "profit_for_range",
        "description": (
            "Profit & loss for a date range (defaults to this month): net sales, cost of "
            "sales, gross/net profit and net margin. Use for 'profit last month', 'P&L "
            "for a period', 'how did we do'. Pass date_from/date_to as YYYY-MM-DD."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "date_from": {"type": "string", "description": "YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD"},
            },
        },
    },
    # ── Write proposals — gather every required field (ASK if missing) before
    # calling these. They DON'T save; they raise a confirmation card for the user.
    {
        "name": "propose_expense",
        "description": (
            "Propose recording a business expense (e.g. a bill, a utility, a purchase). "
            "Gather the amount first; category/date/description are helpful. Does not "
            "save until the user confirms. When reading a photographed bill/receipt, copy "
            "the amount EXACTLY as printed and KEEP the decimal point: £5.99 is 5.99 (never "
            "599), £12.50 is 12.50. Use the grand TOTAL (incl. VAT), not a line item."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "amount": {
                    "type": "number",
                    "description": (
                        "Total amount in £, exactly as printed — keep the decimal point "
                        "(£5.99 → 5.99, not 599). Amounts almost always have 2 decimals."
                    ),
                },
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
                "amount": {
                    "type": "number",
                    "description": (
                        "Gross sale amount in £, exactly as shown — keep the decimal point "
                        "(£5.99 → 5.99, not 599)."
                    ),
                },
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
    {
        "name": "propose_employee",
        "description": (
            "Propose adding ONE staff member. Needs a name; job_title and pay help. "
            "Does not save until the user confirms."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "full name"},
                "job_title": {"type": "string", "description": "Chef, Waiter, Cashier, Manager…"},
                "monthly_salary": {"type": "number", "description": "£ per month, if salaried"},
                "hourly_rate": {"type": "number", "description": "£ per hour, if hourly"},
                "mobile": {"type": "string"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "propose_waste",
        "description": (
            "Propose logging WASTE (spoilage/spillage/over-prep) for a stock item. Needs "
            "the item name + quantity; a reason helps. Decrements stock at avg cost. Does "
            "not save until confirmed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "the stock item's name"},
                "quantity": {"type": "number", "description": "amount wasted (in the item's unit)"},
                "reason": {"type": "string", "description": "e.g. spoiled, spilled, over-prep"},
            },
            "required": ["item", "quantity"],
        },
    },
    {
        "name": "propose_set_supplier",
        "description": (
            "Propose choosing/changing the CHOSEN (preferred) supplier for a stock item — "
            "recipe costing then uses that supplier's price. Needs the item name + the "
            "supplier name; the supplier must already have a price for that item. Saves only "
            "on confirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "the stock item's name"},
                "vendor": {"type": "string", "description": "the supplier's name"},
            },
            "required": ["item", "vendor"],
        },
    },
    {
        "name": "propose_vendor_price",
        "description": (
            "Propose setting/updating a SUPPLIER's price for a stock item (£ per unit). Needs "
            "item, supplier and price. Saves only on confirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "the stock item's name"},
                "vendor": {"type": "string", "description": "the supplier's name"},
                "price": {
                    "type": "number",
                    "description": "price per unit in £, keep the decimal point (£5.99 → 5.99)",
                },
            },
            "required": ["item", "vendor", "price"],
        },
    },
    {
        "name": "propose_stock_count",
        "description": (
            "Propose a STOCK-TAKE: set a stock item's quantity to a freshly counted figure "
            "(records an adjustment to match). Needs the item + the counted quantity in its "
            "unit. Saves only on confirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "the stock item's name"},
                "counted": {
                    "type": "number",
                    "description": "the counted quantity, in the item's unit",
                },
            },
            "required": ["item", "counted"],
        },
    },
    {
        "name": "propose_recipe",
        "description": (
            "Propose adding ONE dish / recipe. Needs a name; category and selling_price help. "
            "(Ingredients are added afterwards on the Recipes page.) Saves only on confirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "the dish name"},
                "category": {
                    "type": "string",
                    "description": "e.g. Starters, Mains, Breads, Rice, Desserts, Drinks",
                },
                "selling_price": {"type": "number", "description": "menu price in £"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "propose_recipe_ingredients",
        "description": (
            "Propose adding/updating the INGREDIENTS of an existing dish — this is what "
            "drives its cost and margin. Give the dish name and a LIST of ingredients, each "
            "with item, quantity and unit (e.g. 100 g rice, 50 g urad dal, 20 ml oil). The "
            "dish must already exist (use propose_recipe first if it doesn't). An ingredient "
            "that isn't in stock yet is created. Saves only on confirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "recipe": {"type": "string", "description": "the existing dish's name"},
                "lines": {
                    "type": "array",
                    "description": "the ingredients used to make ONE serving of the dish",
                    "items": {
                        "type": "object",
                        "properties": {
                            "item": {"type": "string", "description": "ingredient / stock item"},
                            "quantity": {"type": "number", "description": "amount used per dish"},
                            "unit": {"type": "string", "description": "g, kg, ml, l, each…"},
                        },
                        "required": ["item", "quantity"],
                    },
                },
            },
            "required": ["recipe", "lines"],
        },
    },
    {
        "name": "propose_purchase",
        "description": (
            "Propose a PURCHASE ORDER (order stock from suppliers). Give a LIST of items "
            "with quantities (e.g. 10 kg rice, 5 kg paneer). A supplier is OPTIONAL — name "
            "one to order everything from them, otherwise each item's chosen ★ supplier is "
            "used. On confirm it creates an indent and a PO per supplier. Items with no "
            "supplier price are reported, not ordered. Saves only on confirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "vendor": {"type": "string", "description": "optional supplier to order from"},
                "lines": {
                    "type": "array",
                    "description": "the items to order",
                    "items": {
                        "type": "object",
                        "properties": {
                            "item": {"type": "string", "description": "the stock item to order"},
                            "quantity": {"type": "number", "description": "how much to order"},
                            "unit": {"type": "string", "description": "kg, g, l, each…"},
                        },
                        "required": ["item", "quantity"],
                    },
                },
            },
            "required": ["lines"],
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
    "item_detail": item_detail,
    "recipe_detail": recipe_detail,
    "profit_for_range": profit_for_range,
    "navigate": navigate,
    "explain_term": explain_term,
    "propose_expense": propose_expense,
    "propose_sale": propose_sale,
    "propose_item": propose_item,
    "propose_vendor": propose_vendor,
    "propose_employee": propose_employee,
    "propose_waste": propose_waste,
    "propose_set_supplier": propose_set_supplier,
    "propose_vendor_price": propose_vendor_price,
    "propose_stock_count": propose_stock_count,
    "propose_recipe": propose_recipe,
    "propose_recipe_ingredients": propose_recipe_ingredients,
    "propose_purchase": propose_purchase,
}

# Tools gated by a write permission — filtered out for roles that lack it so the
# model is never even offered an action the user can't take.
TOOL_PERMS: dict[str, str] = {
    "propose_expense": "expenses:write",
    "propose_sale": "sales:write",
    "propose_item": "inventory:write",
    "propose_vendor": "vendors:write",
    "propose_employee": "employees:write",
    "propose_waste": "inventory:write",
    "propose_set_supplier": "vendors:write",
    "propose_vendor_price": "vendors:write",
    "propose_stock_count": "inventory:write",
    "propose_recipe": "recipes:write",
    "propose_recipe_ingredients": "recipes:write",
    "propose_purchase": "indent:write",
}


def tools_for(user: User) -> list[dict]:
    """The tool schemas this user's role may use."""
    return [
        t for t in TOOLS
        if t["name"] not in TOOL_PERMS or has_permission(user.role, TOOL_PERMS[t["name"]])
    ]
