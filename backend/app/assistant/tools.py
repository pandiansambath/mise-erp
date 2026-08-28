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

from app.auth.models import Role, User
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
    #: `vendor_count` is NOT a column - it is computed. Reading it straight off
    #: the row raised AttributeError on every search that actually found
    #: something, which killed the whole reply (the tool loop had no guard). It
    #: stayed hidden because the model usually reaches for item_detail instead.
    counts = await inventory_service.vendor_counts(db, user.hotel_id)
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
            "orderable": counts.get(i.id, 0) > 0,
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
        #: `comparisons`, not `vendors` — reading the wrong key made this list
        #: silently empty, so the assistant told people "no suppliers have been
        #: linked" about items that had five. Nothing looked broken.
        #:
        #: And the number handed over is the price per BASE unit, never the raw
        #: quote: one vendor's "£50" is a 5kg box and another's is 100kg, so
        #: comparing the quotes is exactly the mistake this data exists to stop.
        for v in (cmp or {}).get("comparisons", [])[:8]:
            suppliers.append({
                "vendor": v["vendor_name"],
                "price_per_unit": f"{_s(v['price_per_base'])} per {item.unit}",
                "quoted": (
                    f"{_s(v['price_per_unit'])} per {v['pack_level_name']} "
                    f"of {_s(v['pack_size'])} {item.unit}"
                    if v.get("pack_level_name") and v.get("pack_size")
                    else None
                ),
                "chosen": bool(v.get("is_preferred")),
            })
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
    best DineAI page the user can reach, with a direct link."""
    q = (args.get("query") or "").strip().lower()
    can = _can(user)
    # ":self" pages are the staff self-service area. An owner technically passes
    # the check (they hold "*"), but offering "My Space" to the account owner is
    # nonsense — it is the page their STAFF use to see their own rota and
    # payslip. Suggest it only to people who have nothing broader.
    def _relevant(page: dict) -> bool:
        perm = page["perm"]
        if not perm:
            return True
        if not can(perm):
            return False
        if perm.endswith(":self") and user.role != Role.STAFF.value:
            return False
        return True

    visible = [p for p in PAGES if _relevant(p)]
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
    """Define a DineAI / restaurant-finance term in plain English."""
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
async def team_and_access(db: AsyncSession, user: User, args: dict) -> dict:
    """Who is on this team, what role each holds, and what that role can reach.

    This exists because the assistant was answering "what roles do we have and
    what can they see?" with a link to the Staff page — a deflection, not an
    answer. It had no way to know. Now it does.
    """
    from sqlalchemy import func as sa_func
    from sqlalchemy import select

    from app.auth.models import CustomRole
    from app.core.rbac import PERMISSIONS, envelope_for, resolve_permissions

    counts = dict(
        (
            await db.execute(
                select(User.role, sa_func.count())
                .where(User.hotel_id == user.hotel_id, User.is_active.is_(True))
                .group_by(User.role)
            )
        ).all()
    )

    # readable names for what a permission actually lets someone do
    def _areas(perms: list[str]) -> list[str]:
        if "*" in perms:
            return ["everything"]
        seen: list[str] = []
        for perm in sorted(perms):
            area = perm.rsplit(":", 1)[0].replace("_", " ")
            if area not in seen:
                seen.append(area)
        return seen

    roles = []
    for role_key, default_perms in PERMISSIONS.items():
        roles.append(
            {
                "role": role_key.replace("_", " ").title(),
                "members": int(counts.get(role_key, 0)),
                "can_access": _areas(default_perms),
                "could_also_be_given": sorted(
                    set(envelope_for(role_key)) - set(default_perms)
                )
                if "*" not in default_perms
                else [],
            }
        )

    customs = (
        (
            await db.execute(
                select(CustomRole).where(
                    CustomRole.hotel_id == user.hotel_id, CustomRole.is_active.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    custom_rows = [
        {
            "name": c.name,
            "based_on": c.base_role.replace("_", " ").title(),
            "can_access": _areas(resolve_permissions(c.base_role, c.overrides or {})),
        }
        for c in customs
    ]

    return {
        "total_active_users": sum(counts.values()),
        "roles": roles,
        "custom_roles": custom_rows,
        "how_it_works": (
            "Two independent layers decide what someone sees: the hotel's PLAN "
            "decides whether a feature exists at all, and the person's ROLE decides "
            "whether they may use it. An owner can create a custom role with any "
            "name, but only ever with permissions inside its base role's envelope — "
            "so a waiter can never be given Hiring, however the toggles are set."
        ),
    }




async def vendor_detail(db: AsyncSession, user: User, args: dict) -> dict:
    """One supplier in full: how to reach them, terms, and what they supply."""
    from sqlalchemy import func as _func
    from sqlalchemy import select as _select

    from app.inventory.models import Item
    from app.vendors.models import Vendor, VendorItem

    if not has_permission(user.role, "vendors:read"):
        return {"error": "You don't have access to suppliers."}

    name = (args.get("vendor") or "").strip()
    if not name:
        return {"error": "Which supplier?"}

    vendor = (
        await db.execute(
            _select(Vendor)
            .where(
                Vendor.hotel_id == user.hotel_id,
                _func.lower(Vendor.name).like(f"%{name.lower()}%"),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if vendor is None:
        return {"error": f"No supplier matching {name!r}."}

    rows = (
        await db.execute(
            _select(VendorItem, Item.name, Item.unit)
            .join(Item, Item.id == VendorItem.item_id)
            .where(VendorItem.vendor_id == vendor.id)
            .order_by(Item.name)
            .limit(80)
        )
    ).all()

    return {
        "name": vendor.name,
        "category": vendor.category,
        "contact": vendor.contact_person,
        "mobile": vendor.mobile,
        "email": vendor.email,
        "address": vendor.address,
        "payment_type": vendor.payment_type,
        "payment_frequency": vendor.payment_frequency,
        "supplies": [
            {
                "item": iname,
                "price": float(vi.price_per_unit or 0),
                "unit": unit,
                "preferred": bool(vi.is_preferred),
                "updated": str(vi.last_updated),
            }
            for vi, iname, unit in rows
        ],
        "items_count": len(rows),
    }


async def price_comparison(db: AsyncSession, user: User, args: dict) -> dict:
    """Who sells this item, at what price, cheapest first.

    "which vendor is cheapest for guava" had no tool at all — it was answered by
    guessing at SQL, which is how the assistant once said an item had no
    suppliers when five of them stocked it.
    """
    from sqlalchemy import func as _func
    from sqlalchemy import select as _select

    from app.inventory.models import Item
    from app.vendors.models import Vendor, VendorItem

    if not has_permission(user.role, "vendors:read"):
        return {"error": "You don't have access to supplier prices."}

    name = (args.get("item") or "").strip()
    if not name:
        return {"error": "Which item?"}

    item = (
        await db.execute(
            _select(Item)
            .where(
                Item.hotel_id == user.hotel_id,
                _func.lower(Item.name).like(f"%{name.lower()}%"),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if item is None:
        return {"error": f"No item matching {name!r}."}

    rows = (
        await db.execute(
            _select(VendorItem, Vendor.name)
            .join(Vendor, Vendor.id == VendorItem.vendor_id)
            .where(VendorItem.item_id == item.id, Vendor.hotel_id == user.hotel_id)
            .order_by(VendorItem.price_per_unit)
        )
    ).all()

    offers = [
        {
            "vendor": vname,
            "price": float(vi.price_per_unit or 0),
            "preferred": bool(vi.is_preferred),
            "updated": str(vi.last_updated),
            "notes": vi.notes,
        }
        for vi, vname in rows
    ]
    cheapest = offers[0] if offers else None
    chosen = next((o for o in offers if o["preferred"]), None)
    saving = None
    if cheapest and chosen and chosen["price"] > cheapest["price"]:
        saving = round(chosen["price"] - cheapest["price"], 2)

    return {
        "item": item.name,
        "unit": item.unit,
        "offers": offers,
        "cheapest": cheapest,
        "currently_chosen": chosen,
        "saving_per_unit_if_switched": saving,
        "note": "Nobody is listed as supplying this yet." if not offers else None,
    }


async def price_changes(db: AsyncSession, user: User, args: dict) -> dict:
    """What suppliers have changed their prices to, and when."""
    from datetime import datetime, time, timedelta

    from sqlalchemy import select as _select

    from app.core.timezones import hotel_today
    from app.hotels.models import Hotel as _Hotel
    from app.inventory.models import Item
    from app.vendors.models import PriceHistory, Vendor

    if not has_permission(user.role, "vendors:read"):
        return {"error": "You don't have access to supplier prices."}

    hotel = await db.get(_Hotel, user.hotel_id)
    today = hotel_today(hotel)
    start = _d(args.get("date_from"), today - timedelta(days=60))

    rows = (
        await db.execute(
            _select(PriceHistory, Item.name, Vendor.name)
            .join(Item, Item.id == PriceHistory.item_id)
            .join(Vendor, Vendor.id == PriceHistory.vendor_id, isouter=True)
            .where(
                PriceHistory.hotel_id == user.hotel_id,
                PriceHistory.created_at >= datetime.combine(start, time.min),
            )
            .order_by(PriceHistory.created_at.desc())
            .limit(50)
        )
    ).all()

    changes = [
        {
            "item": iname,
            "vendor": vname,
            "from": float(ph.old_price) if ph.old_price is not None else None,
            "to": float(ph.new_price or 0),
            "when": str(ph.created_at.date()),
            "how": ph.source,
        }
        for ph, iname, vname in rows
    ]
    risen = [c for c in changes if c["from"] is not None and c["to"] > c["from"]]
    return {
        "since": str(start),
        "changes": changes,
        "gone_up": len(risen),
        "note": "No price changes recorded in that period." if not changes else None,
    }


async def indents(db: AsyncSession, user: User, args: dict) -> dict:
    """Purchase requests — what the kitchen has asked to be bought."""
    from sqlalchemy import select as _select

    from app.inventory.models import Item
    from app.purchasing.models import Indent, IndentItem

    if not has_permission(user.role, "purchasing:read"):
        return {"error": "You don't have access to purchasing."}

    heads = (
        (
            await db.execute(
                _select(Indent)
                .where(Indent.hotel_id == user.hotel_id)
                .order_by(Indent.date.desc())
                .limit(10)
            )
        )
        .scalars()
        .all()
    )
    out = []
    for ind in heads:
        lines = (
            await db.execute(
                _select(IndentItem, Item.name, Item.unit)
                .join(Item, Item.id == IndentItem.item_id)
                .where(IndentItem.indent_id == ind.id)
                .limit(40)
            )
        ).all()
        out.append(
            {
                "date": str(ind.date),
                "status": ind.status,
                "notes": ind.notes,
                "items": [
                    {"item": nm, "qty": float(li.required_qty or 0), "unit": un}
                    for li, nm, un in lines
                ],
            }
        )
    return {"indents": out, "count": len(out)}


async def stock_history(db: AsyncSession, user: User, args: dict) -> dict:
    """Everything that moved one item: deliveries, usage, waste, corrections."""
    from sqlalchemy import func as _func
    from sqlalchemy import select as _select

    from app.inventory.models import Item, StockMovement
    from app.vendors.models import Vendor

    if not has_permission(user.role, "inventory:read"):
        return {"error": "You don't have access to stock."}

    name = (args.get("item") or "").strip()
    if not name:
        return {"error": "Which item?"}

    item = (
        await db.execute(
            _select(Item)
            .where(
                Item.hotel_id == user.hotel_id,
                _func.lower(Item.name).like(f"%{name.lower()}%"),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if item is None:
        return {"error": f"No item matching {name!r}."}

    rows = (
        await db.execute(
            _select(StockMovement, Vendor.name)
            .join(Vendor, Vendor.id == StockMovement.vendor_id, isouter=True)
            .where(StockMovement.item_id == item.id)
            .order_by(StockMovement.created_at.desc())
            .limit(40)
        )
    ).all()

    return {
        "item": item.name,
        "unit": item.unit,
        "in_stock": float(item.current_stock or 0),
        "movements": [
            {
                "what": mv.movement_type,
                "quantity": float(mv.quantity or 0),
                "unit_cost": float(mv.unit_cost) if mv.unit_cost is not None else None,
                "vendor": vname,
                "when": str(mv.created_at.date()),
                "notes": mv.notes,
            }
            for mv, vname in rows
        ],
    }


async def rota_shifts(db: AsyncSession, user: User, args: dict) -> dict:
    """Who is rota'd on, by name, for a day or a range.

    There was NO rota tool at all. So "is there a rota for Balaji today" left the
    model only `query_data` — raw SQL — which failed with a ProgrammingError,
    was retried three times, spent the whole lap budget, and produced no answer.
    That is the "Sorry, I got tangled up and lost my thread" he kept hearing: not
    a model that could not think, a model with no way to look.
    """
    from sqlalchemy import select as _select

    from app.core.timezones import hotel_today
    from app.employees.models import Employee
    from app.hotels.models import Hotel as _Hotel
    from app.rota.models import Shift

    if not has_permission(user.role, "employees:read"):
        return {"error": "You don't have access to the rota."}

    hotel = await db.get(_Hotel, user.hotel_id)
    start = _d(args.get("date_from") or args.get("date"), hotel_today(hotel))
    end = _d(args.get("date_to") or args.get("date"), start)
    if end < start:
        start, end = end, start

    rows = (
        await db.execute(
            _select(Shift, Employee.full_name)
            .join(Employee, Employee.id == Shift.employee_id)
            .where(
                Shift.hotel_id == user.hotel_id,
                Shift.date >= start,
                Shift.date <= end,
            )
            .order_by(Shift.date, Shift.start_time)
        )
    ).all()

    who = (args.get("employee") or "").strip().lower()
    shifts = [
        {
            "date": str(sh.date),
            "who": name,
            "from": sh.start_time.strftime("%H:%M"),
            "to": sh.end_time.strftime("%H:%M"),
            "break_minutes": sh.break_minutes,
            "notes": sh.notes,
        }
        for sh, name in rows
        # A spoken name is rarely spelled the way it is stored, so match loosely
        # in both directions rather than demanding equality.
        if not who or who in (name or "").lower() or (name or "").lower() in who
    ]
    return {
        "from": str(start),
        "to": str(end),
        "asked_about": args.get("employee") or None,
        "shifts": shifts,
        "count": len(shifts),
        "note": (
            "No shifts rota'd on for that." if not shifts else None
        ),
    }



async def attendance_summary(db: AsyncSession, user: User, args: dict) -> dict:
    """Hours worked and who was in, over a range rather than just today.

    `staff_today` answers "who is in right now". This answers "how many hours
    did Balaji do this week" - a different question, and one with no tool.
    """
    from datetime import timedelta

    from sqlalchemy import select as _select

    from app.core.timezones import hotel_today
    from app.employees.models import Attendance, Employee
    from app.hotels.models import Hotel as _Hotel

    if not has_permission(user.role, "employees:read"):
        return {"error": "You don't have access to attendance."}

    hotel = await db.get(_Hotel, user.hotel_id)
    today = hotel_today(hotel)
    start = _d(args.get("date_from") or args.get("date"), today - timedelta(days=7))
    end = _d(args.get("date_to") or args.get("date"), today)
    if end < start:
        start, end = end, start

    rows = (
        await db.execute(
            _select(Attendance, Employee.full_name)
            .join(Employee, Employee.id == Attendance.employee_id)
            .where(
                Attendance.hotel_id == user.hotel_id,
                Attendance.date >= start,
                Attendance.date <= end,
            )
            .order_by(Attendance.date)
        )
    ).all()

    who = (args.get("employee") or "").strip().lower()
    days = []
    for att, name in rows:
        low = (name or "").lower()
        if who and who not in low and low not in who:
            continue
        hours = getattr(att, "worked_hours", None)
        days.append(
            {
                "date": str(att.date),
                "who": name,
                "status": getattr(att.status, "value", att.status),
                "in": att.clock_in.strftime("%H:%M") if att.clock_in else None,
                "out": att.clock_out.strftime("%H:%M") if att.clock_out else None,
                "hours": float(hours) if hours is not None else None,
            }
        )
    return {
        "from": str(start),
        "to": str(end),
        "days": days[:60],
        "total_hours": round(sum(d["hours"] or 0 for d in days), 2),
        "note": "Nothing recorded for that range." if not days else None,
    }


async def payroll_summary(db: AsyncSession, user: User, args: dict) -> dict:
    """What was paid, for which period, and any advances still to come back."""
    from sqlalchemy import select as _select

    from app.employees.models import Employee
    from app.payroll.models import Payroll, SalaryAdvance

    if not has_permission(user.role, "payroll:read"):
        return {"error": "You don't have access to payroll."}

    runs = (
        await db.execute(
            _select(Payroll, Employee.full_name)
            .join(Employee, Employee.id == Payroll.employee_id)
            .where(Payroll.hotel_id == user.hotel_id)
            .order_by(Payroll.period_start.desc())
            .limit(40)
        )
    ).all()
    advances = (
        await db.execute(
            _select(SalaryAdvance, Employee.full_name)
            .join(Employee, Employee.id == SalaryAdvance.employee_id)
            .where(
                SalaryAdvance.hotel_id == user.hotel_id,
                SalaryAdvance.is_deducted.is_(False),
            )
            .order_by(SalaryAdvance.given_date.desc())
            .limit(25)
        )
    ).all()

    return {
        "runs": [
            {
                "who": name,
                "period": pr.pay_period,
                "status": pr.status,
                "gross": float(pr.gross_pay or 0),
                "net": float(pr.net_pay or 0),
                "days_present": pr.days_present,
            }
            for pr, name in runs
        ],
        "advances_outstanding": [
            {
                "who": name,
                "amount": float(a.amount or 0),
                "given": str(a.given_date),
                "reason": a.reason,
            }
            for a, name in advances
        ],
        "advances_total": round(sum(float(a.amount or 0) for a, _ in advances), 2),
    }


async def purchase_orders(db: AsyncSession, user: User, args: dict) -> dict:
    """Orders placed with suppliers - what is on its way and what it costs."""
    from sqlalchemy import select as _select

    from app.purchasing.models import PurchaseOrder
    from app.vendors.models import Vendor

    if not has_permission(user.role, "purchasing:read"):
        return {"error": "You don't have access to purchasing."}

    rows = (
        await db.execute(
            _select(PurchaseOrder, Vendor.name)
            .join(Vendor, Vendor.id == PurchaseOrder.vendor_id, isouter=True)
            .where(PurchaseOrder.hotel_id == user.hotel_id)
            .order_by(PurchaseOrder.created_at.desc())
            .limit(30)
        )
    ).all()

    want = (args.get("status") or "").strip().upper()
    orders = [
        {
            "number": po.po_number,
            "vendor": vname,
            "status": po.status,
            "total": float(po.total_amount or 0),
            "expected": str(po.expected_delivery) if po.expected_delivery else None,
        }
        for po, vname in rows
        if not want or (po.status or "").upper() == want
    ]
    return {"orders": orders, "count": len(orders)}


async def waste_summary(db: AsyncSession, user: User, args: dict) -> dict:
    """What has been thrown away, and what it cost.

    Waste is a stock MOVEMENT rather than a table of its own - exactly the sort
    of thing the model cannot guess and kept writing broken SQL for.
    """
    from datetime import datetime, time, timedelta

    from sqlalchemy import select as _select

    from app.core.timezones import hotel_today
    from app.hotels.models import Hotel as _Hotel
    from app.inventory.models import Item, MovementType, StockMovement

    if not has_permission(user.role, "inventory:read"):
        return {"error": "You don't have access to stock."}

    hotel = await db.get(_Hotel, user.hotel_id)
    today = hotel_today(hotel)
    start = _d(args.get("date_from") or args.get("date"), today - timedelta(days=30))
    end = _d(args.get("date_to") or args.get("date"), today)

    rows = (
        await db.execute(
            _select(StockMovement, Item.name, Item.unit)
            .join(Item, Item.id == StockMovement.item_id)
            .where(
                Item.hotel_id == user.hotel_id,
                StockMovement.movement_type == MovementType.WASTE.value,
                StockMovement.created_at >= datetime.combine(start, time.min),
                StockMovement.created_at <= datetime.combine(end, time.max),
            )
            .order_by(StockMovement.created_at.desc())
            .limit(60)
        )
    ).all()

    entries = [
        {
            "item": name,
            "quantity": float(mv.quantity or 0),
            "unit": unit,
            "cost": round(float(mv.quantity or 0) * float(mv.unit_cost or 0), 2),
            "when": str(mv.created_at.date()),
            "notes": mv.notes,
        }
        for mv, name, unit in rows
    ]
    return {
        "from": str(start),
        "to": str(end),
        "entries": entries,
        "total_cost": round(sum(e["cost"] for e in entries), 2),
        "note": "Nothing thrown away in that period." if not entries else None,
    }


async def online_orders(db: AsyncSession, user: User, args: dict) -> dict:
    """Delivery and collection orders - how many, and what they came to."""
    from datetime import datetime, time

    from sqlalchemy import select as _select

    from app.core.timezones import hotel_today
    from app.hotels.models import Hotel as _Hotel
    from app.ordering.models import Order

    hotel = await db.get(_Hotel, user.hotel_id)
    today = hotel_today(hotel)
    start = _d(args.get("date_from") or args.get("date"), today)
    end = _d(args.get("date_to") or args.get("date"), today)

    rows = (
        (
            await db.execute(
                _select(Order)
                .where(
                    Order.hotel_id == user.hotel_id,
                    Order.created_at >= datetime.combine(start, time.min),
                    Order.created_at <= datetime.combine(end, time.max),
                )
                .order_by(Order.created_at.desc())
                .limit(50)
            )
        )
        .scalars()
        .all()
    )

    orders = [
        {
            "code": o.code,
            "customer": o.customer_name,
            "how": getattr(o.fulfilment, "value", o.fulfilment),
            "status": getattr(o.status, "value", o.status),
            "total": float(getattr(o, "total", 0) or 0),
        }
        for o in rows
    ]
    return {
        "from": str(start),
        "to": str(end),
        "orders": orders,
        "count": len(orders),
        "takings": round(sum(o["total"] for o in orders), 2),
    }


async def safety_checks(db: AsyncSession, user: User, args: dict) -> dict:
    """Fridge temperatures and the rest of the daily safety log."""
    from sqlalchemy import select as _select

    from app.core.timezones import hotel_today
    from app.hotels.models import Hotel as _Hotel
    from app.safety.models import SafetyLog

    hotel = await db.get(_Hotel, user.hotel_id)
    day = _d(args.get("date"), hotel_today(hotel))
    rows = (
        (
            await db.execute(
                _select(SafetyLog)
                .where(SafetyLog.hotel_id == user.hotel_id, SafetyLog.date == day)
                .order_by(SafetyLog.created_at)
            )
        )
        .scalars()
        .all()
    )
    return {
        "date": str(day),
        "checks": [
            {
                "what": lg.label,
                "kind": lg.kind,
                "reading": lg.reading,
                "status": lg.status,
                "notes": lg.notes,
            }
            for lg in rows
        ],
        "logged": len(rows),
        "note": "Nothing logged today yet." if not rows else None,
    }


async def staff_today(db: AsyncSession, user: User, args: dict) -> dict:
    """The actual people, by name, with today's attendance.

    `team_and_access` answers "what ROLES exist"; it was being used for "who
    works here", which is why the assistant kept saying names aren't available
    and pointing at a page. They are available — it just had no tool for them.
    """
    from datetime import UTC, datetime

    from sqlalchemy import select as _select

    from app.employees.models import Attendance, Employee

    if not has_permission(user.role, "employees:read"):
        return {"error": "You don't have access to staff records."}

    # The restaurant's today, not the server's. A night shift in Chennai would
    # otherwise disappear from "today" for five and a half hours.
    from app.core.timezones import hotel_today
    from app.hotels.models import Hotel as _Hotel

    _hotel = await db.get(_Hotel, user.hotel_id)
    day = _d(args.get("date"), hotel_today(_hotel))
    people = (
        (
            await db.execute(
                _select(Employee)
                .where(Employee.hotel_id == user.hotel_id, Employee.is_active.is_(True))
                .order_by(Employee.full_name)
            )
        )
        .scalars()
        .all()
    )
    marks = {
        a.employee_id: a
        for a in (
            await db.execute(
                _select(Attendance).where(
                    Attendance.hotel_id == user.hotel_id, Attendance.date == day
                )
            )
        )
        .scalars()
        .all()
    }

    def _t(dt) -> str | None:
        # Seconds matter here: a clock-in and clock-out in the same MINUTE looks
        # like a data error at HH:MM, and like a 40-second shift at HH:MM:SS.
        return dt.strftime("%H:%M:%S") if dt else None

    now = datetime.now(UTC)
    rows = []
    for p in people:
        a = marks.get(p.id)
        cin = getattr(a, "clock_in", None) if a else None
        cout = getattr(a, "clock_out", None) if a else None

        # Derive what the raw columns don't say, so the assistant can reason
        # about it instead of reading two timestamps aloud.
        state, worked_minutes = "not marked", None
        if cin and cout:
            worked_minutes = round((cout - cin).total_seconds() / 60, 1)
            state = "left"
        elif cin:
            worked_minutes = round((now - cin).total_seconds() / 60, 1)
            state = "still working"
        elif a and getattr(a, "status", None):
            state = str(a.status).lower()

        rows.append(
            {
                "name": p.full_name,
                "role": (getattr(p, "job_title", None) or "").strip() or None,
                # No attendance row means nobody marked them either way today —
                # say that, rather than implying they were absent.
                "today": (a.status if a else "not marked"),
                "state": state,
                "clock_in": _t(cin),
                "clock_out": _t(cout),
                "worked_minutes": worked_minutes,
                # A shift under two minutes is almost always a mis-tap, and the
                # owner wants that flagged rather than reported as a shift.
                "looks_like_a_mistake": bool(
                    worked_minutes is not None and state == "left" and worked_minutes < 2
                ),
            }
        )

    return {
        "date": str(day),
        "now": now.strftime("%H:%M:%S"),
        "total_staff": len(rows),
        "still_working": sum(1 for r in rows if r["state"] == "still working"),
        "left_already": sum(1 for r in rows if r["state"] == "left"),
        "not_marked": sum(1 for r in rows if r["state"] == "not marked"),
        "suspicious_shifts": [r["name"] for r in rows if r["looks_like_a_mistake"]],
        "staff": rows[:120],
    }


async def query_data(db: AsyncSession, user: User, args: dict) -> dict:
    """Read this hotel's data with SQL, for anything the other tools don't cover.

    The escape hatch that makes the assistant a master of THIS restaurant rather
    than a master of twenty-nine pre-built questions. Safety lives in the ai_*
    views and in query.validate — see app/assistant/query.py.
    """
    from app.assistant import query as q

    return await q.run(db, user, args.get("sql") or "")


async def web_lookup(db: AsyncSession, user: User, args: dict) -> dict:
    """Guarded live web search. The guard lives in websearch.allowed()."""
    from app.assistant import websearch

    return await websearch.search(args.get("query") or "", int(args.get("count") or 5))


TOOLS: list[dict] = [
    {
        "name": "web_lookup",
        "description": (
            "Search the LIVE public web for restaurant and hospitality "
            "information this restaurant's own records cannot answer: current "
            "ingredient or wholesale prices, suppliers, food-safety and hygiene "
            "rules, minimum wage changes, what other venues charge, industry "
            "news. Use it when the answer depends on the outside world rather "
            "than their books, and ALWAYS say the figure came from the web "
            "rather than from their data. It refuses anything outside "
            "hospitality - medical, legal, financial-advice and similar - and "
            "you must not try to reword a blocked question to get past it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to search for, in plain words",
                },
                "count": {"type": "integer", "description": "How many results (1-10, default 5)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "query_data",
        "description": (
            "Read this restaurant's data with a SQL SELECT, for anything the "
            "other tools do not cover. Use it rather than telling someone to go "
            "and look at a page. Query ONLY these views, which are already "
            "limited to this hotel: ai_items, ai_vendors, ai_vendor_items, "
            "ai_recipes, ai_recipe_ingredients, ai_indents, ai_indent_items, "
            "ai_purchase_orders, ai_po_items, ai_price_history, ai_expenses, "
            "ai_expense_categories, ai_daily_sales, ai_dish_sales, "
            "ai_sales_channels, ai_menu_items, ai_orders, ai_order_items, "
            "ai_employees, ai_attendance, ai_payroll, ai_salary_advances, "
            "ai_shifts, ai_documents, ai_safety_logs, ai_party_quotes, "
            "ai_party_quote_lines, ai_budget_targets, ai_job_postings, "
            "ai_job_applications. One SELECT, no semicolons, no comments. "
            "If a column name is wrong the error will say so — fix it and retry."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "A single SELECT over ai_* views"}
            },
            "required": ["sql"],
        },
    },
    {
        "name": "vendor_detail",
        "description": (
            "ONE supplier in full: phone, email, contact, payment terms, and "
            "every item they supply with the price. Use for 'what is Farm2Land's "
            "number', 'what does RUDRA supply', 'when do we pay them'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "vendor": {"type": "string", "description": "Supplier name, matched loosely"}
            },
            "required": ["vendor"],
        },
    },
    {
        "name": "price_comparison",
        "description": (
            "Who sells an item and at what price, CHEAPEST FIRST, plus which one "
            "is currently chosen and what switching would save. Use for 'which "
            "vendor is cheapest for guava', 'who should I buy tomatoes from', "
            "'am I overpaying for onions'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "Item name, matched loosely"}
            },
            "required": ["item"],
        },
    },
    {
        "name": "price_changes",
        "description": (
            "Supplier prices that have moved, newest first, with what they were "
            "before. Use for 'what has gone up', 'have prices changed', 'why is "
            "my food cost up'."
        ),
        "parameters": {
            "type": "object",
            "properties": {"date_from": {"type": "string", "description": "YYYY-MM-DD"}},
        },
    },
    {
        "name": "indents",
        "description": (
            "Purchase requests raised by the kitchen, with their lines. Use for "
            "'what has been requested', 'any indents waiting', 'what did the "
            "kitchen ask for'. Different from purchase_orders, which is what has "
            "actually been ordered from a supplier."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "stock_history",
        "description": (
            "Everything that moved one item - deliveries in, usage out, waste, "
            "corrections - with dates, costs and which supplier. Use for 'where "
            "did the onions go', 'when did we last get rice', 'why is this "
            "item's cost different'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "Item name, matched loosely"}
            },
            "required": ["item"],
        },
    },
    {
        "name": "rota_shifts",
        "description": (
            "Who is rota'd on to work, BY NAME, for a day or a date range. Use for "
            "'is there a rota for Balaji today', 'who is working tomorrow', "
            "'check the rota', 'what shifts are on this week'. This is the ONLY "
            "way to read the rota - never write SQL for it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD; today if omitted"},
                "date_from": {"type": "string", "description": "YYYY-MM-DD, for a range"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD, for a range"},
                "employee": {
                    "type": "string",
                    "description": "Only this person's shifts, matched loosely by name",
                },
            },
        },
    },
    {
        "name": "attendance_summary",
        "description": (
            "Hours worked and who was in, over a DATE RANGE. Use for 'how many "
            "hours did Balaji do this week', 'who was late', 'attendance last "
            "month'. For just today, staff_today is quicker."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD, one day"},
                "date_from": {"type": "string"},
                "date_to": {"type": "string"},
                "employee": {"type": "string", "description": "One person, matched loosely"},
            },
        },
    },
    {
        "name": "payroll_summary",
        "description": (
            "Wages: what each person was paid, for which period, and any salary "
            "advances still to be deducted. Use for 'what is the wage bill', "
            "'has payroll been run', 'who has taken an advance'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "purchase_orders",
        "description": (
            "Orders placed with suppliers - number, vendor, status, total and "
            "expected delivery. Use for 'what is on order', 'what is arriving', "
            "'any open purchase orders'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "e.g. DRAFT, SENT, RECEIVED"}
            },
        },
    },
    {
        "name": "waste_summary",
        "description": (
            "What has been thrown away and what it cost, over a range. Use for "
            "'how much waste this month', 'what are we throwing away'. Waste is "
            "a stock movement, not a table - never write SQL for it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "date": {"type": "string"},
                "date_from": {"type": "string"},
                "date_to": {"type": "string"},
            },
        },
    },
    {
        "name": "online_orders",
        "description": (
            "Delivery and collection orders for a day or range: how many, who "
            "for, and what they came to. Use for 'how many online orders "
            "today', 'what did delivery take'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "date": {"type": "string"},
                "date_from": {"type": "string"},
                "date_to": {"type": "string"},
            },
        },
    },
    {
        "name": "safety_checks",
        "description": (
            "The daily safety log - fridge temperatures, cleaning, and what is "
            "still outstanding. Use for 'have the safety checks been done', "
            "'what is the fridge temperature'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD; today if omitted"}
            },
        },
    },
    {
        "name": "staff_today",
        "description": (
            "The actual people who work here, BY NAME, with today's attendance "
            "(present/absent/leave, clock in and out). Use for 'how many staff do "
            "we have', 'list my staff', 'who is in today', 'who clocked in', "
            "'attendance today'. Prefer this over team_and_access whenever the "
            "question is about PEOPLE rather than roles or permissions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD; today if omitted"}
            },
        },
    },
    {
        "name": "team_and_access",
        "description": (
            "The hotel's roles: how many people hold each, what each role can "
            "access, and any custom roles the owner created. Use for 'what roles "
            "do we have', 'how many staff', 'who can see payroll', 'what can a "
            "chef access', 'what will my manager see on their dashboard'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
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
            "Find the right DineAI page for what the user wants to do, and return a "
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
            "Define a restaurant-finance or DineAI term (e.g. 'slow stock', 'food cost "
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
    "team_and_access": team_and_access,
    "staff_today": staff_today,
    "rota_shifts": rota_shifts,
    "vendor_detail": vendor_detail,
    "price_comparison": price_comparison,
    "price_changes": price_changes,
    "indents": indents,
    "stock_history": stock_history,
    "attendance_summary": attendance_summary,
    "payroll_summary": payroll_summary,
    "purchase_orders": purchase_orders,
    "waste_summary": waste_summary,
    "online_orders": online_orders,
    "safety_checks": safety_checks,
    "query_data": query_data,
    "web_lookup": web_lookup,
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
    "staff_today": "employees:read",
    "rota_shifts": "employees:read",
    "vendor_detail": "vendors:read",
    "price_comparison": "vendors:read",
    "price_changes": "vendors:read",
    "indents": "purchasing:read",
    "stock_history": "inventory:read",
    "attendance_summary": "employees:read",
    "payroll_summary": "payroll:read",
    "purchase_orders": "purchasing:read",
    "waste_summary": "inventory:read",
    "online_orders": "orders:read",
    "safety_checks": "inventory:read",
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


# Tools gated by a PLAN feature rather than a role permission. Filtered out
# entirely when the hotel's plan does not include them, so the model never
# offers a capability the customer has not bought and then has to walk back.
TOOL_FEATURES: dict[str, str] = {
    "web_lookup": "ai_web",
}


def tools_for(user: User, hotel=None) -> list[dict]:
    """The tool schemas this user's role and this hotel's plan allow.

    `hotel` is optional so existing callers keep working; without it the
    feature-gated tools are simply not offered, which is the safe direction.
    """
    out = []
    for t in TOOLS:
        name = t["name"]
        if name in TOOL_PERMS and not has_permission(user.role, TOOL_PERMS[name]):
            continue
        feature = TOOL_FEATURES.get(name)
        if feature and (hotel is None or not hotel.feature_on(feature)):
            continue
        out.append(t)
    return out
