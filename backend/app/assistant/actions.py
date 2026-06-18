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
from app.expenses import service as expense_service
from app.expenses.models import Expense
from app.inventory import service as inventory_service
from app.inventory.models import Item
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


def build_proposal(kind: str, fields: dict) -> dict:
    """Validate + normalise a requested action WITHOUT writing. Returns either
    {ok:true, ...} ready to confirm, or {ok:false, missing:[...]} so the model
    knows what to still ask for."""
    spec = SPECS.get(kind)
    if not spec:
        return {"ok": False, "error": f"I can't do '{kind}' yet."}
    clean: dict[str, Any] = {}
    # numeric-ish fields
    for f in ("amount", "current_stock", "cost_price"):
        if fields.get(f) is not None:
            d = _dec(fields[f])
            if d is not None:
                clean[f] = d
    # text fields
    for f in ("name", "unit", "category", "description", "channel", "kind",
              "payment_method", "date", "contact_person", "mobile", "email"):
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
    return {"ok": False, "error": "Nothing to undo (already removed?)."}
