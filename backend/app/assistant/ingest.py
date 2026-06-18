"""Document onboarding — upload a PDF/image/CSV of your existing items or
suppliers and the Copilot reads it (Gemini multimodal), extracts structured
rows, and (after you confirm) bulk-creates them via the normal services.

Two steps so a human always confirms before anything is written:
  • extract()  — read the file, return proposed rows. Writes NOTHING.
  • commit()   — create the confirmed rows, scoped to the user's hotel + RBAC,
                 audit-logged so it's traceable/undoable.
"""
from __future__ import annotations

import base64
import json
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.models import User
from app.core.config import settings
from app.core.rbac import has_permission
from app.inventory import service as inventory_service
from app.vendors import service as vendor_service

from .provider import ProviderError, is_configured

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
}

MAX_BYTES = 15 * 1024 * 1024  # Gemini inline-data ceiling is ~20MB; stay under it


def kind_perm(kind: str) -> str | None:
    cfg = KINDS.get(kind)
    return cfg["perm"] if cfg else None


async def extract(file_bytes: bytes, mime: str, kind: str) -> list[dict]:
    """Read the uploaded document and return proposed rows (writes nothing)."""
    if kind not in KINDS:
        raise ValueError(f"Unknown document kind '{kind}'")
    if not is_configured():
        raise ProviderError("no api key")
    cfg = KINDS[kind]

    try:
        import httpx
    except ImportError as exc:
        raise ProviderError("httpx not installed") from exc

    url = _ENDPOINT.format(model=settings.assistant_model)
    body = {
        "contents": [{"role": "user", "parts": [
            {"text": cfg["prompt"]},
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(file_bytes).decode()}},
        ]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": cfg["schema"],
            "temperature": 0.1,
            "maxOutputTokens": 8192,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, params={"key": settings.gemini_api_key}, json=body)
            if resp.status_code >= 300:
                raise ProviderError(f"gemini {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
        text = "".join(
            p.get("text", "") for p in data["candidates"][0]["content"]["parts"]
        )
        rows = json.loads(text)
        if not isinstance(rows, list):
            return []
        return [r for r in rows if isinstance(r, dict) and r.get("name")]
    except ProviderError:
        raise
    except Exception as exc:  # noqa: BLE001 — network/JSON → caller decides
        raise ProviderError(str(exc)) from exc


def _dec(v: Any) -> str | None:
    try:
        return str(Decimal(str(v)))
    except (InvalidOperation, TypeError, ValueError):
        return None


async def commit(db: AsyncSession, user: User, kind: str, rows: list[dict]) -> dict:
    """Create the confirmed rows. Skips duplicates/invalid; audit-logged."""
    cfg = KINDS.get(kind)
    if not cfg:
        return {"error": f"Unknown document kind '{kind}'"}
    if not has_permission(user.role, cfg["perm"]):
        return {"error": f"You don't have permission to add {cfg['label']}."}

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
            else:
                await vendor_service.create_vendor(db, user.hotel_id, **fields)
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
