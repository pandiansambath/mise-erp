"""What the Copilot can WRITE — the master-mind layer, kept safe.

The model never mutates the database directly. It calls a propose_* tool, which
validates + normalises the request and returns a human-readable proposal (no
write). The UI shows a confirmation card; only when the user confirms does the
frontend call /assistant/act, which EXECUTES here via the normal services,
scoped to the user's hotel + RBAC, and audit-logged. Every action returns an
``undo`` token so the user can reverse it (/assistant/undo).
"""
from __future__ import annotations

import uuid
from datetime import date as date_type
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import User
from app.core.rbac import has_permission
from app.employees import service as employee_service
from app.employees.models import Employee
from app.expenses import service as expense_service
from app.expenses.models import Expense
from app.inventory import service as inventory_service
from app.inventory.models import Item, MovementType
from app.recipes import service as recipe_service
from app.recipes.models import Recipe
from app.sales import service as sales_service
from app.sales.models import DailySales, SalesLine
from app.vendors import service as vendor_service
from app.vendors.models import Vendor

# kind -> permission + required fields + a one-line summary builder.
SPECS: dict[str, dict] = {
    "expense": {
        "perm": "expenses:write",
        "label": "expense",
        "required": ["amount"],
        "summary": lambda f: (
            f"Record a £{f['amount']} expense"
            + (f" for “{f['description']}”" if f.get("description") else "")
            + (f" under {f['category']}" if f.get("category") else "")
            + f", dated {f.get('date', 'today')}"
        ),
    },
    "sale": {
        "perm": "sales:write",
        "label": "sale",
        "required": ["amount"],
        "summary": lambda f: (
            f"Record a £{f['amount']} sale"
            + (f" on {f['channel']}" if f.get("channel") else "")
            + f", dated {f.get('date', 'today')}"
        ),
    },
    "item": {
        "perm": "inventory:write",
        "label": "stock item",
        "required": ["name", "unit"],
        "summary": lambda f: (
            f"Add stock item “{f['name']}” ({f.get('unit', '')})"
            + (f", {f['current_stock']} in stock" if f.get("current_stock") else "")
            + (f" at £{f['cost_price']}/{f.get('unit', 'unit')}" if f.get("cost_price") else "")
        ),
    },
    "vendor": {
        "perm": "vendors:write",
        "label": "supplier",
        "required": ["name"],
        "summary": lambda f: (
            f"Add supplier “{f['name']}”"
            + (f" ({f['category']})" if f.get("category") else "")
        ),
    },
    "employee": {
        "perm": "employees:write",
        "label": "staff member",
        "required": ["name"],
        "summary": lambda f: (
            f"Add staff member “{f['name']}”"
            + (f" — {f['job_title']}" if f.get("job_title") else "")
            + (f", £{f['monthly_salary']}/mo" if f.get("monthly_salary") else "")
        ),
    },
    "waste": {
        "perm": "inventory:write",
        "label": "waste entry",
        "required": ["item", "quantity"],
        "summary": lambda f: (
            f"Log {f['quantity']} of “{f['item']}” as waste"
            + (f" — {f['reason']}" if f.get("reason") else "")
        ),
    },
    "set_supplier": {
        "perm": "vendors:write",
        "label": "chosen supplier",
        "required": ["item", "vendor"],
        "summary": lambda f: f"Set {f['vendor']} as the chosen supplier for “{f['item']}”",
    },
    "vendor_price": {
        "perm": "vendors:write",
        "label": "supplier price",
        "required": ["item", "vendor", "price"],
        "summary": lambda f: f"Set {f['vendor']}’s price for “{f['item']}” to £{f['price']}",
    },
    "stock_count": {
        "perm": "inventory:write",
        "label": "stock-take count",
        "required": ["item", "counted"],
        "summary": lambda f: f"Set “{f['item']}” stock to {f['counted']} (stock-take adjustment)",
    },
    "recipe": {
        "perm": "recipes:write",
        "label": "dish",
        "required": ["name"],
        "summary": lambda f: (
            f"Add dish “{f['name']}”"
            + (f" in {f['category']}" if f.get("category") else "")
            + (f", sells at £{f['selling_price']}" if f.get("selling_price") else "")
        ),
    },
    # Multi-line action: a recipe + a LIST of ingredient rows (item/quantity/unit).
    "recipe_ingredients": {
        "perm": "recipes:write",
        "label": "recipe ingredients",
        "required": ["recipe", "lines"],  # validated specially (see build_proposal)
        "summary": lambda f: (
            f"Add {len(f['lines'])} ingredient"
            + ("" if len(f["lines"]) == 1 else "s")
            + f" to “{f['recipe']}”: "
            + ", ".join(
                f"{ln['quantity']}{(' ' + ln['unit']) if ln.get('unit') else ''} {ln['item']}"
                for ln in f["lines"][:6]
            )
            + ("…" if len(f["lines"]) > 6 else "")
        ),
    },
}


def _dec(v: Any) -> str | None:
    try:
        return str(Decimal(str(v)))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _resolve_date(v: Any) -> date_type:
    s = str(v or "").strip().lower()
    if not s or s in ("today", "now"):
        return date_type.today()
    if s == "yesterday":
        return date_type.today() - timedelta(days=1)
    try:
        return date_type.fromisoformat(str(v)[:10])
    except ValueError:
        return date_type.today()


def _build_lines(fields: dict) -> list[dict]:
    """Normalise a list of {item, quantity, unit} rows (for multi-line actions)."""
    out: list[dict] = []
    for ln in fields.get("lines") or []:
        if not isinstance(ln, dict):
            continue
        item = str(ln.get("item") or "").strip()
        qty = _dec(ln.get("quantity"))
        unit = str(ln.get("unit") or "").strip()
        if item and qty is not None and Decimal(qty) > 0:
            out.append({"item": item, "quantity": qty, "unit": unit})
    return out


def build_proposal(kind: str, fields: dict) -> dict:
    """Validate + normalise a requested action WITHOUT writing. Returns either
    {ok:true, ...} ready to confirm, or {ok:false, missing:[...]} so the model
    knows what to still ask for."""
    spec = SPECS.get(kind)
    if not spec:
        return {"ok": False, "error": f"I can't do '{kind}' yet."}

    # Multi-line proposals carry a list of rows (e.g. recipe ingredients).
    if kind == "recipe_ingredients":
        recipe = str(fields.get("recipe") or "").strip()
        lines = _build_lines(fields)
        missing = [m for m, ok in (("recipe", recipe), ("lines", lines)) if not ok]
        if missing:
            return {"ok": False, "kind": kind, "missing": missing}
        clean_ml = {"recipe": recipe, "lines": lines}
        return {
            "ok": True, "kind": kind, "label": spec["label"],
            "fields": clean_ml, "summary": spec["summary"](clean_ml),
        }

    clean: dict[str, Any] = {}
    # numeric-ish fields
    for f in ("amount", "current_stock", "cost_price", "quantity", "monthly_salary",
              "hourly_rate", "price", "counted", "selling_price"):
        if fields.get(f) is not None:
            d = _dec(fields[f])
            if d is not None:
                clean[f] = d
    # text fields
    for f in ("name", "unit", "category", "description", "channel", "kind",
              "payment_method", "date", "contact_person", "mobile", "email",
              "item", "vendor", "job_title", "reason"):
        v = fields.get(f)
        if isinstance(v, str) and v.strip():
            clean[f] = v.strip()
    missing = [f for f in spec["required"] if f not in clean]
    if missing:
        return {"ok": False, "kind": kind, "missing": missing}
    return {
        "ok": True,
        "kind": kind,
        "label": spec["label"],
        "fields": clean,
        "summary": spec["summary"](clean),
    }


# ── Execute (after the human confirms) ────────────────────────────────────────
async def execute(db: AsyncSession, user: User, kind: str, fields: dict) -> dict:
    spec = SPECS.get(kind)
    if not spec:
        return {"ok": False, "error": f"Unknown action '{kind}'"}
    if not has_permission(user.role, spec["perm"]):
        return {"ok": False, "error": f"You don't have permission to add a {spec['label']}."}
    prop = build_proposal(kind, fields)
    if not prop.get("ok"):
        return {"ok": False, "error": "Missing details: " + ", ".join(prop.get("missing", []))}
    f = prop["fields"]
    hotel = user.hotel_id

    if kind == "expense":
        undo = await _do_expense(db, user, f)
    elif kind == "sale":
        undo = await _do_sale(db, user, f)
    elif kind == "item":
        item = await inventory_service.create_item(
            db, hotel, **_item_fields(f)
        )
        undo = {"type": "item", "id": str(item.id)}
    elif kind == "vendor":
        vendor = await vendor_service.create_vendor(db, hotel, **_vendor_fields(f))
        undo = {"type": "vendor", "id": str(vendor.id)}
    elif kind == "employee":
        emp = await employee_service.create_employee(db, hotel, **_employee_fields(f))
        undo = {"type": "employee", "id": str(emp.id)}
    elif kind == "waste":
        item = await inventory_service.get_item_by_name(db, hotel, f["item"])
        if item is None:
            items = await inventory_service.list_items(db, hotel)
            item = next((i for i in items if f["item"].lower() in (i.name or "").lower()), None)
        if item is None:
            return {"ok": False, "error": f"No stock item matches '{f['item']}'."}
        await inventory_service.record_waste(
            db, item, Decimal(f["quantity"]), f.get("reason") or "Waste", created_by=user.id
        )
        undo = {}  # reversing a stock movement isn't offered yet — adjust on the Waste page
    elif kind == "set_supplier":
        item = await _find_item(db, hotel, f["item"])
        if item is None:
            return {"ok": False, "error": f"No stock item matches '{f['item']}'."}
        vendor = await _find_vendor(db, hotel, f["vendor"])
        if vendor is None:
            return {"ok": False, "error": f"No supplier matches '{f['vendor']}'."}
        ok = await vendor_service.set_preferred_vendor(db, hotel, item.id, vendor.id)
        if not ok:
            return {
                "ok": False,
                "error": f"{vendor.name} doesn't supply {item.name} yet — "
                "set their price for it first, then choose them.",
            }
        undo = {}  # the previous choice isn't stored to restore
    elif kind == "vendor_price":
        item = await _find_item(db, hotel, f["item"])
        if item is None:
            return {"ok": False, "error": f"No stock item matches '{f['item']}'."}
        vendor = await _find_vendor(db, hotel, f["vendor"])
        if vendor is None:
            return {"ok": False, "error": f"No supplier matches '{f['vendor']}'."}
        await vendor_service.upsert_vendor_item(db, vendor.id, item.id, Decimal(f["price"]))
        undo = {}
    elif kind == "stock_count":
        item = await _find_item(db, hotel, f["item"])
        if item is None:
            return {"ok": False, "error": f"No stock item matches '{f['item']}'."}
        delta = Decimal(f["counted"]) - item.current_stock
        if delta != 0:
            await inventory_service.record_movement(
                db, item, MovementType.ADJUSTMENT.value, delta,
                notes="Stock-take (Copilot)", created_by=user.id,
            )
        undo = {}
    elif kind == "recipe":
        try:
            rec = await recipe_service.create_recipe(db, hotel, **_recipe_fields(f))
        except recipe_service.DuplicateRecipeError as exc:
            return {"ok": False, "error": str(exc)}
        undo = {"type": "recipe", "id": str(rec.id)}
    elif kind == "recipe_ingredients":
        rec = await _find_recipe(db, hotel, f["recipe"])
        if rec is None:
            return {
                "ok": False,
                "error": f"No dish called '{f['recipe']}' — create the dish first, "
                "then I'll add its ingredients.",
            }
        added: list[str] = []
        for ln in f["lines"]:
            item = await _find_item(db, hotel, ln["item"])
            if item is None:  # ingredient not in stock yet → create a basic item
                item = await inventory_service.create_item(
                    db, hotel, name=ln["item"], unit=(ln["unit"] or "g")
                )
            await recipe_service.upsert_ingredient(
                db, rec.id, item.id, Decimal(ln["quantity"]), ln["unit"] or item.unit
            )
            added.append(item.name)
        # No single-token undo for a batch; edit on the Recipes page if needed.
        undo = {}
    else:  # pragma: no cover
        return {"ok": False, "error": f"Unknown action '{kind}'"}

    await audit.record(
        db, hotel_id=hotel, user=user, action=f"assistant.act.{kind}",
        summary=f"Copilot: {prop['summary']}", entity_type=kind,
        entity_id=uuid.UUID(undo["id"]) if undo.get("id") else None,
    )
    return {"ok": True, "summary": prop["summary"], "undo": undo}


def _item_fields(f: dict) -> dict:
    out = {k: f[k] for k in ("name", "unit", "category", "current_stock", "cost_price") if k in f}
    if f.get("cost_price"):
        out["average_cost"] = f["cost_price"]
    return out


def _vendor_fields(f: dict) -> dict:
    return {k: f[k] for k in ("name", "category", "contact_person", "mobile", "email") if k in f}


def _employee_fields(f: dict) -> dict:
    out: dict[str, Any] = {"full_name": f["name"]}
    for k in ("job_title", "mobile", "monthly_salary", "hourly_rate"):
        if k in f:
            out[k] = f[k]
    return out


def _recipe_fields(f: dict) -> dict:
    out: dict[str, Any] = {"name": f["name"]}
    for k in ("category", "selling_price"):
        if k in f:
            out[k] = f[k]
    return out


async def _find_item(db: AsyncSession, hotel: uuid.UUID, name: str) -> Item | None:
    """Resolve a stock item by exact name, else a loose contains-match."""
    item = await inventory_service.get_item_by_name(db, hotel, name)
    if item is None:
        items = await inventory_service.list_items(db, hotel)
        item = next((i for i in items if name.lower() in (i.name or "").lower()), None)
    return item


async def _find_vendor(db: AsyncSession, hotel: uuid.UUID, name: str) -> Vendor | None:
    """Resolve a supplier by exact name, else a loose contains-match."""
    nl = name.lower()
    vendors = await vendor_service.list_vendors(db, hotel)
    return next(
        (v for v in vendors if v.name and (nl == v.name.lower() or nl in v.name.lower())),
        None,
    )


async def _find_recipe(db: AsyncSession, hotel: uuid.UUID, name: str) -> Recipe | None:
    """Resolve an active dish by exact name, else a loose contains-match."""
    nl = name.lower()
    recipes = await recipe_service.list_recipes(db, hotel, active_only=True)
    return next(
        (r for r in recipes if r.name and (nl == r.name.lower() or nl in r.name.lower())),
        None,
    )


async def _do_expense(db: AsyncSession, user: User, f: dict) -> dict:
    hotel = user.hotel_id
    ekind = (f.get("kind") or "variable").lower()
    if ekind not in ("fixed", "variable"):
        ekind = "variable"
    cat = None
    cats = await expense_service.list_categories(db, hotel, active_only=False)
    if f.get("category"):
        cat = next((c for c in cats if c.name.lower() == f["category"].lower()), None)
        if cat is None:
            cat = await expense_service.create_category(db, hotel, f["category"], ekind)
    if cat is None:
        cat = next(
            (c for c in cats if c.name.lower() in ("general", "other", "miscellaneous")), None
        )
        if cat is None:
            cat = await expense_service.create_category(db, hotel, "General", "variable")
    exp = await expense_service.create_expense(
        db, hotel, category_id=cat.id, amount=Decimal(f["amount"]),
        date=_resolve_date(f.get("date")), description=f.get("description"),
        payment_method=(f.get("payment_method") or "BANK").upper(), created_by=user.id,
    )
    return {"type": "expense", "id": str(exp.id)}


async def _do_sale(db: AsyncSession, user: User, f: dict) -> dict:
    hotel = user.hotel_id
    ch_name = f.get("channel") or "Dine-in"
    ch = await sales_service.get_channel_by_name(db, hotel, ch_name)
    if ch is None:
        ch = await sales_service.create_channel(db, hotel, ch_name, Decimal("0"))
    day = await sales_service.upsert_day(
        db, hotel, _resolve_date(f.get("date")), entered_by=user.id
    )
    line = await sales_service.add_line(
        db, day, ch.id, Decimal(f["amount"]), (f.get("payment_method") or "CARD").upper()
    )
    return {"type": "sale_line", "id": str(line.id)}


# ── Undo ──────────────────────────────────────────────────────────────────────
async def undo(db: AsyncSession, user: User, kind: str, entity_id: str) -> dict:
    """Reverse a just-performed action. Hotel-scoped; safe no-op if gone."""
    try:
        eid = uuid.UUID(entity_id)
    except (ValueError, TypeError):
        return {"ok": False, "error": "Invalid id"}
    hotel = user.hotel_id

    if kind == "expense":
        exp = await db.get(Expense, eid)
        if exp and exp.hotel_id == hotel:
            await db.delete(exp)
            await db.commit()
            return {"ok": True, "summary": "Removed that expense."}
    elif kind == "sale_line":
        line = await db.get(SalesLine, eid)
        if line:
            day = await db.get(DailySales, line.daily_sales_id)
            if day and day.hotel_id == hotel:
                await db.delete(line)
                await db.commit()
                return {"ok": True, "summary": "Removed that sale."}
    elif kind == "item":
        item = await db.get(Item, eid)
        if item and item.hotel_id == hotel:
            item.is_active = False
            await db.commit()
            return {"ok": True, "summary": "Archived that stock item."}
    elif kind == "vendor":
        vendor = await db.get(Vendor, eid)
        if vendor and vendor.hotel_id == hotel:
            vendor.is_active = False
            await db.commit()
            return {"ok": True, "summary": "Archived that supplier."}
    elif kind == "employee":
        emp = await db.get(Employee, eid)
        if emp and emp.hotel_id == hotel:
            emp.is_active = False
            await db.commit()
            return {"ok": True, "summary": "Archived that staff member."}
    elif kind == "recipe":
        rec = await db.get(Recipe, eid)
        if rec and rec.hotel_id == hotel:
            rec.is_active = False
            await db.commit()
            return {"ok": True, "summary": "Archived that dish."}
    return {"ok": False, "error": "Nothing to undo (already removed?)."}
