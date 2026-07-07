"""AWS Textract helpers.

Two jobs:
  • analyze_expense() — read a vendor INVOICE/receipt into structured line items
    (AnalyzeExpense is purpose-built for this: item, qty, unit price, vendor, total).
  • detect_lines()    — OCR a document incl. HANDWRITING into text lines (recipe notes).

Uses the EC2 instance role for credentials (same as S3). boto3 is imported lazily so
local dev needn't install/configure AWS.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from app.core.config import settings


class TextractError(RuntimeError):
    """Textract unavailable, unpermitted, or the document couldn't be read."""


def _client():
    import boto3  # lazy — keeps local dev / tests free of AWS
    return boto3.client("textract", region_name=settings.aws_region)


def _dec(s: str | None) -> Decimal | None:
    """Pull a number out of a messy Textract string ('£1.25', '1,250.00')."""
    if not s:
        return None
    cleaned = "".join(ch for ch in s.replace(",", "") if ch.isdigit() or ch in ".-")
    try:
        return Decimal(cleaned) if cleaned not in ("", ".", "-") else None
    except InvalidOperation:
        return None


def _s(d: Decimal | None) -> str | None:
    return str(d) if d is not None else None


def analyze_expense(data: bytes) -> dict:
    """Parse an invoice/receipt → {vendor, total, line_items:[{description, qty,
    unit_price, total}]}. Fields Textract can't find come back as None."""
    try:
        resp = _client().analyze_expense(Document={"Bytes": data})
    except Exception as exc:
        raise TextractError(f"Could not read the invoice: {exc}") from exc

    vendor: str | None = None
    total: Decimal | None = None
    line_items: list[dict] = []

    for doc in resp.get("ExpenseDocuments", []):
        for f in doc.get("SummaryFields", []):
            ftype = (f.get("Type") or {}).get("Text", "")
            val = (f.get("ValueDetection") or {}).get("Text")
            if ftype in ("VENDOR_NAME", "SUPPLIER_NAME", "NAME") and not vendor:
                vendor = val
            elif ftype in ("TOTAL", "AMOUNT_DUE") and total is None:
                total = _dec(val)
        for grp in doc.get("LineItemGroups", []):
            for li in grp.get("LineItems", []):
                row: dict = {"description": None, "qty": None, "unit_price": None, "total": None}
                for f in li.get("LineItemExpenseFields", []):
                    ftype = (f.get("Type") or {}).get("Text", "")
                    val = (f.get("ValueDetection") or {}).get("Text")
                    if ftype == "ITEM":
                        row["description"] = (val or "").strip() or None
                    elif ftype == "QUANTITY":
                        row["qty"] = _dec(val)
                    elif ftype == "UNIT_PRICE":
                        row["unit_price"] = _dec(val)
                    elif ftype == "PRICE":
                        row["total"] = _dec(val)
                if row["description"]:
                    line_items.append(row)

    return {
        "vendor": vendor,
        "total": _s(total),
        "line_items": [
            {
                "description": r["description"],
                "qty": _s(r["qty"]),
                "unit_price": _s(r["unit_price"]),
                "total": _s(r["total"]),
            }
            for r in line_items
        ],
    }


def detect_lines(data: bytes) -> list[str]:
    """OCR a document (including handwriting) → text lines, top-to-bottom."""
    try:
        resp = _client().detect_document_text(Document={"Bytes": data})
    except Exception as exc:
        raise TextractError(f"Could not read the note: {exc}") from exc
    lines = [
        (b.get("Text") or "")
        for b in resp.get("Blocks", [])
        if b.get("BlockType") == "LINE"
    ]
    return [ln for ln in lines if ln.strip()]
