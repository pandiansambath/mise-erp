"""Document onboarding — upload a PDF/image/CSV of your existing items or
suppliers and the Copilot reads it (Claude on Bedrock), extracts structured
rows, and (after you confirm) bulk-creates them via the normal services.

Two steps so a human always confirms before anything is written:
  • extract()  — read the file, return proposed rows. Writes NOTHING.
  • commit()   — create the confirmed rows, scoped to the user's hotel + RBAC,
                 audit-logged so it's traceable/undoable.
"""
from __future__ import annotations

import json
import re
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import User
from app.core.rbac import has_permission
from app.employees import service as employee_service
from app.inventory import service as inventory_service
from app.recipes import service as recipe_service
from app.sales import service as sales_service
from app.vendors import service as vendor_service

from . import bedrock, docbytes
from .provider import ProviderError

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

_ITEM_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "unit": {"type": "string"},
            "category": {"type": "string"},
            "current_stock": {"type": "number"},
            "cost_price": {"type": "number"},
        },
        "required": ["name", "unit"],
    },
}
_VENDOR_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "category": {"type": "string"},
            "contact_person": {"type": "string"},
            "mobile": {"type": "string"},
            "email": {"type": "string"},
        },
        "required": ["name"],
    },
}

_RECIPE_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "category": {"type": "string"},
            "selling_price": {"type": "number"},
        },
        "required": ["name"],
    },
}
_EMPLOYEE_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "job_title": {"type": "string"},
            "monthly_salary": {"type": "number"},
            "hourly_rate": {"type": "number"},
            "mobile": {"type": "string"},
        },
        "required": ["name"],
    },
}
_SALES_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "date": {"type": "string"},
            "channel": {"type": "string"},
            "amount": {"type": "number"},
        },
        "required": ["amount"],
    },
}

# kind -> how to extract + how to write it
KINDS: dict[str, dict] = {
    "items": {
        "perm": "inventory:write",
        "label": "stock items",
        "schema": _ITEM_SCHEMA,
        "str_fields": ["name", "unit", "category"],
        "num_fields": ["current_stock", "cost_price"],
        "prompt": (
            "You are reading a restaurant's stock / inventory document. Extract EVERY "
            "distinct stock item. For each: name (the ingredient or product), unit "
            "(kg, g, l, ml, each, pack, bottle…), category if shown (e.g. Vegetables, "
            "Dairy, Meat, Dry Goods, Packaging), current_stock as a number if a quantity "
            "is shown, and cost_price per unit as a number if a price is shown. Skip "
            "headers, totals and section titles. Omit any field that isn't present."
        ),
    },
    "vendors": {
        "perm": "vendors:write",
        "label": "suppliers",
        "schema": _VENDOR_SCHEMA,
        "str_fields": ["name", "category", "contact_person", "mobile", "email"],
        "num_fields": [],
        "prompt": (
            "You are reading a restaurant's supplier / vendor list. Extract EVERY "
            "supplier. For each: name (company or person), category (what they supply, "
            "e.g. Vegetables, Meat, Dairy, Packaging), contact_person, mobile (phone "
            "number), email. Skip anything that isn't a supplier. Omit absent fields."
        ),
    },
    "recipes": {
        "perm": "recipes:write",
        "label": "dishes",
        "schema": _RECIPE_SCHEMA,
        "str_fields": ["name", "category"],
        "num_fields": ["selling_price"],
        "prompt": (
            "You are reading a restaurant's MENU or recipe list. Extract EVERY dish. "
            "For each: name (the dish), category if shown (e.g. Starters, Mains, Breads, "
            "Rice, Desserts, Drinks), and selling_price as a number if a menu price is "
            "shown. Skip section headers, prices-only lines and notes. Omit absent fields."
        ),
    },
    "employees": {
        "perm": "employees:write",
        "label": "staff",
        "schema": _EMPLOYEE_SCHEMA,
        "str_fields": ["name", "job_title", "mobile"],
        "num_fields": ["monthly_salary", "hourly_rate"],
        "prompt": (
            "You are reading a restaurant's STAFF / employee list. Extract EVERY person. "
            "For each: name (full name), job_title (e.g. Chef, Waiter, Cashier, Manager, "
            "Kitchen Porter), monthly_salary as a number if shown, hourly_rate as a number "
            "if shown, mobile (phone number). Skip headers and totals. Omit absent fields."
        ),
    },
    "sales": {
        "perm": "sales:write",
        "label": "sales entries",
        "schema": _SALES_SCHEMA,
        "str_fields": ["date", "channel"],
        "num_fields": ["amount"],
        "prompt": (
            "You are reading a restaurant's past SALES / takings / revenue report. Extract "
            "the takings as rows: date (the day, any format shown), channel (e.g. Dine-in, "
            "Takeaway, Uber Eats, Deliveroo, Just Eat — use 'Dine-in' if not specified), and "
            "amount (the takings for that day/channel, as a number). One row per day per "
            "channel. Skip totals, subtotals, headers and any non-sales lines."
        ),
    },
}

MAX_BYTES = 15 * 1024 * 1024  # Bedrock's per-request payload ceiling; stay under it


def kind_perm(kind: str) -> str | None:
    cfg = KINDS.get(kind)
    return cfg["perm"] if cfg else None


# The file-type helpers that used to live here moved to `docbytes`, whole.
# They were correct; the problem was that `understand_document` had its own,
# incorrect copy of the same decision, and only one of the two got fixed.


async def extract(
    file_bytes: bytes, mime: str, kind: str, filename: str = ""
) -> list[dict]:
    """Read the uploaded document and return proposed rows (writes nothing).

    On Bedrock, like everything else in the assistant. Spreadsheets are still
    converted to CSV text first: no model can read an .xlsx binary, and handing
    it one produces confident nonsense rather than an error.

    `filename` matters because CONTENT TYPES LIE. A .csv exported from this
    very product and re-uploaded from Windows commonly arrives as
    `application/octet-stream`, and a phone will label almost anything
    `application/octet-stream` too. The suffix is the more reliable signal of
    the two, so both are consulted.
    """
    if kind not in KINDS:
        raise ValueError(f"Unknown document kind '{kind}'")
    cfg = KINDS[kind]

    schema_hint = (
        "\n\nReply with a JSON ARRAY only - no prose, no code fences. Each "
        "element must match this shape:\n"
        + json.dumps(cfg["schema"], default=str)[:2000]
    )

    # ONE DECODER, SHARED WITH `understand_document`. This branch used to live
    # here and only here, which is exactly why the other reader still wrapped
    # spreadsheets in an image block long after this one had stopped.
    content = docbytes.blocks(file_bytes, mime, filename, cfg["prompt"] + schema_hint)

    try:
        raw = bedrock._invoke(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 8192,
                "messages": [{"role": "user", "content": content}],
            }
        )
    except bedrock.BedrockUnavailable as exc:
        raise ProviderError(str(exc)) from exc

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text, flags=re.S)
    try:
        rows = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\[.*\]", text, flags=re.S)
        if not m:
            raise ProviderError("The AI returned something we couldn't read.") from None
        try:
            rows = json.loads(m.group(0))
        except json.JSONDecodeError as exc:
            raise ProviderError("The AI returned something we couldn't read.") from exc

    if not isinstance(rows, list):
        return []
    key = "amount" if kind == "sales" else "name"
    return [r for r in rows if isinstance(r, dict) and r.get(key) is not None]


def _dec(v: Any) -> str | None:
    try:
        return str(Decimal(str(v)))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _resolve_date(v: Any) -> date_type:
    """Parse a date cell from a report. UK-first (DD/MM). Falls back to today."""
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date_type):
        return v
    s = str(v or "").strip()
    if not s or s.lower() in ("today", "now"):
        return date_type.today()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d %b %Y", "%d %B %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:11].strip(), fmt).date()
        except ValueError:
            continue
    return date_type.today()


async def _commit_sales(db: AsyncSession, user: User, rows: list[dict]) -> dict:
    """Bulk-import past takings: each row {date, channel, amount} → resolve/create the
    channel, upsert that day, add a line. Date-keyed (no 'name'), so it has its own path."""
    hotel = user.hotel_id
    created: list[str] = []
    skipped: list[str] = []
    for row in rows:
        amt = _dec(row.get("amount"))
        if amt is None or Decimal(amt) <= 0:
            continue
        d = _resolve_date(row.get("date"))
        ch_name = (row.get("channel") or "").strip() or "Dine-in"
        try:
            ch = await sales_service.get_channel_by_name(db, hotel, ch_name)
            if ch is None:
                ch = await sales_service.create_channel(db, hotel, ch_name, Decimal("0"))
            day = await sales_service.upsert_day(db, hotel, d, entered_by=user.id)
            await sales_service.add_line(db, day, ch.id, Decimal(amt), "CARD")
            created.append(f"{d} {ch_name}: {amt}")
        except Exception:  # noqa: BLE001 — bad row → skip, keep going
            skipped.append(str(row.get("date")))
    if created:
        await audit.record(
            db, hotel_id=hotel, user=user, action="assistant.onboard.sales",
            summary=f"Copilot onboarding imported {len(created)} sales entries",
            entity_type="sales",
        )
    return {"kind": "sales", "created": created, "skipped": skipped}



#: The lists `read_any` can recognise, in the order it should prefer them when
#: a document genuinely could be two things. Stock last: a delivery note looks
#: like stock AND like a supplier, and the supplier is the more useful read.
AUTO_LISTS = ("vendors", "employees", "recipes", "inventory")


def _auto_prompt() -> str:
    """Built FROM THE SPECS, so a field added to a list reaches the model
    without anybody remembering to edit a prompt."""
    from app.core import lists as list_specs

    described = []
    for slug in AUTO_LISTS:
        spec = list_specs.EXPORTABLE[slug]
        fields = ", ".join(
            f.key + (" (required)" if f.required else "") for f in spec.fields
        )
        described.append(f'  "{slug}" — {spec.name}. Fields: {fields}')

    return (
        "You are reading a document a restaurant has just uploaded. Work out "
        "WHICH ONE of these lists it is, then extract every row of it.\n\n"
        + "\n".join(described)
        + "\n\nReply with JSON only — no prose, no code fences:\n"
        '{"list": "<one of: ' + ", ".join(AUTO_LISTS) + '>", '
        '"rows": [ {...}, {...} ]}\n\n'
        "Rules:\n"
        "- Use exactly the field names listed above for the list you chose.\n"
        "- Omit any field the document does not state. DO NOT GUESS A VALUE; "
        "an empty field is fixable by a person, an invented one is not.\n"
        "- Skip headers, totals, subtotals, page numbers and signature lines.\n"
        "- Money and quantities as plain numbers, no currency symbols.\n"
        '- If it is none of these four, reply {"list": null, "rows": []} and '
        "nothing else."
    )


async def read_any(
    file_bytes: bytes, mime: str, filename: str = ""
) -> tuple[str | None, list[dict]]:
    """Identify the list and extract its rows, in a single model call.

    Returns (slug, rows). `slug` is None when the document is none of the four
    — a takeaway leaflet, a bank statement, a photo of a dog — and the caller
    says so plainly rather than proposing rows nobody asked for.
    """
    content = docbytes.blocks(file_bytes, mime, filename, _auto_prompt())
    try:
        raw = bedrock._invoke(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 8192,
                "messages": [{"role": "user", "content": content}],
            }
        )
    except bedrock.BedrockUnavailable as exc:
        raise ProviderError(str(exc)) from exc

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text, flags=re.S)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if not m:
            raise ProviderError("The AI returned something we couldn't read.") from None
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError as exc:
            raise ProviderError("The AI returned something we couldn't read.") from exc

    if not isinstance(data, dict):
        return None, []
    slug = data.get("list")
    # RESOLVED AGAINST OUR OWN TABLE, never trusted as a path or a key. A model
    # that answers "employees-with-pay" must not thereby reach the pay list.
    if slug not in AUTO_LISTS:
        return None, []
    rows = data.get("rows")
    return slug, [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []



def _one_list_prompt(slug: str) -> str:
    """Extract THIS list. Built from the spec, so a field added to a list
    reaches the model without anybody remembering to edit a prompt."""
    from app.core import lists as list_specs

    spec = list_specs.EXPORTABLE[slug]
    fields = "\n".join(
        f"  {f.key}"
        + (" (REQUIRED)" if f.required else "")
        + (f" — {f.header}" if f.header.lower() != f.key else "")
        for f in spec.fields
    )
    return (
        f"You are reading a restaurant's {spec.name.lower()} list. It may be a "
        "spreadsheet, a typed document, a PDF, or a photograph of a "
        "handwritten page. Extract EVERY row you can see.\n\n"
        f"Fields:\n{fields}\n\n"
        'Reply with JSON only - no prose, no code fences: {"rows": [ {...} ]}\n\n'
        "Rules:\n"
        "- Use exactly the field names above.\n"
        "- Omit any field the document does not state. DO NOT GUESS A VALUE; "
        "an empty field is fixable by a person, an invented one is not and is "
        "worse than a gap.\n"
        "- Skip headings, totals, subtotals, page numbers and signatures.\n"
        "- Money and quantities as plain numbers, no currency symbols.\n"
        "- A row per THING, never a row per line of text: a dish whose name "
        "wraps onto two lines is one dish.\n"
        "- If the document holds none of this, reply {\"rows\": []}."
    )


async def read_as(
    file_bytes: bytes, mime: str, filename: str, slug: str
) -> list[dict]:
    """Read one document AS a named list. Returns rows; writes nothing.

    The list is passed in rather than guessed. Guessing is what turned his
    stock sheet into five suppliers, and inside a section there is nothing
    to guess — he has already said which section he is in.
    """
    from app.core import lists as list_specs

    if slug not in list_specs.EXPORTABLE:
        raise ProviderError(f"No such list '{slug}'")

    content = docbytes.blocks(file_bytes, mime, filename, _one_list_prompt(slug))
    try:
        raw = bedrock._invoke(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 8192,
                "messages": [{"role": "user", "content": content}],
            }
        )
    except bedrock.BedrockUnavailable as exc:
        raise ProviderError(str(exc)) from exc

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text, flags=re.S)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if not m:
            raise ProviderError("The AI returned something we couldn't read.") from None
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError as exc:
            raise ProviderError("The AI returned something we couldn't read.") from exc

    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    allowed = {f.key for f in list_specs.EXPORTABLE[slug].fields}
    return [
        {k: v for k, v in r.items() if k in allowed}
        for r in rows
        if isinstance(r, dict)
    ]


async def commit(db: AsyncSession, user: User, kind: str, rows: list[dict]) -> dict:
    """Create the confirmed rows. Skips duplicates/invalid; audit-logged."""
    cfg = KINDS.get(kind)
    if not cfg:
        return {"error": f"Unknown document kind '{kind}'"}
    if not has_permission(user.role, cfg["perm"]):
        return {"error": f"You don't have permission to add {cfg['label']}."}

    if kind == "sales":  # date-keyed, not name-keyed → dedicated path
        return await _commit_sales(db, user, rows)

    created: list[str] = []
    skipped: list[str] = []
    for row in rows:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        fields: dict[str, Any] = {}
        for f in cfg["str_fields"]:
            val = row.get(f)
            if isinstance(val, str) and val.strip():
                fields[f] = val.strip()
        for f in cfg["num_fields"]:
            if row.get(f) is not None:
                d = _dec(row[f])
                if d is not None:
                    fields[f] = d
        # opening stock is worth nothing on the books without a cost — seed the
        # weighted-average so valuation is right from day one.
        if kind == "items" and fields.get("cost_price"):
            fields["average_cost"] = fields["cost_price"]
        try:
            if kind == "items":
                await inventory_service.create_item(db, user.hotel_id, **fields)
            elif kind == "vendors":
                await vendor_service.create_vendor(db, user.hotel_id, **fields)
            elif kind == "recipes":
                await recipe_service.create_recipe(db, user.hotel_id, **fields)
            elif kind == "employees":
                ef = {k: v for k, v in fields.items() if k != "name"}
                ef["full_name"] = name
                await employee_service.create_employee(db, user.hotel_id, **ef)
            else:
                continue
            created.append(name)
        except Exception:  # noqa: BLE001 — duplicate/validation → skip, keep going
            skipped.append(name)

    if created:
        await audit.record(
            db, hotel_id=user.hotel_id, user=user, action=f"assistant.onboard.{kind}",
            summary=f"Copilot onboarding added {len(created)} {cfg['label']}",
            entity_type=kind,
        )
    return {"kind": kind, "created": created, "skipped": skipped}
