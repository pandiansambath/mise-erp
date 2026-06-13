"""CSV / Excel export for inventory: stock-on-hand valuation and the waste log.
Amounts are in the hotel's base currency (the display-currency toggle is view-only)."""
import csv
import io
from datetime import date as date_type
from decimal import Decimal

from openpyxl import Workbook
from openpyxl.styles import Font

_Q2 = Decimal("0.01")


def _value(item) -> Decimal:
    return (item.current_stock * item.average_cost).quantize(_Q2)


def _supplier(item, suppliers: dict | None) -> str:
    chosen = (suppliers or {}).get(item.id)
    if not chosen:
        return ""
    name, is_chosen = chosen
    return f"{'★ ' if is_chosen else ''}{name}"


# ── Inventory stock valuation ────────────────────────────────────────────────
_ITEM_COLS = [
    "Item", "Category", "In stock", "Unit", "Min stock",
    "Avg cost", "Stock value", "Supplier", "Status",
]


def items_to_csv(items, suppliers: dict | None = None) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Mise — Inventory stock valuation"])
    w.writerow([])
    w.writerow(_ITEM_COLS)
    total = Decimal("0")
    for it in items:
        val = _value(it)
        total += val
        w.writerow([
            it.name, it.category or "", str(it.current_stock), it.unit,
            str(it.min_stock_level) if it.min_stock_level is not None else "",
            str(it.average_cost), str(val), _supplier(it, suppliers),
            "active" if it.is_active else "archived",
        ])
    w.writerow([])
    w.writerow(["", "", "", "", "", "Total stock value", str(total.quantize(_Q2))])
    return buf.getvalue().encode("utf-8")


def items_to_xlsx(items, suppliers: dict | None = None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Stock valuation"
    ws.cell(row=1, column=1, value="Mise — Inventory stock valuation").font = Font(
        bold=True, size=14
    )
    for col, h in enumerate(_ITEM_COLS, start=1):
        ws.cell(row=3, column=col, value=h).font = Font(bold=True)
    r = 4
    total = 0.0
    for it in items:
        val = float(_value(it))
        total += val
        ws.cell(row=r, column=1, value=it.name)
        ws.cell(row=r, column=2, value=it.category or "")
        ws.cell(row=r, column=3, value=float(it.current_stock))
        ws.cell(row=r, column=4, value=it.unit)
        min_v = float(it.min_stock_level) if it.min_stock_level is not None else None
        ws.cell(row=r, column=5, value=min_v)
        ws.cell(row=r, column=6, value=float(it.average_cost)).number_format = "#,##0.0000"
        ws.cell(row=r, column=7, value=val).number_format = "#,##0.00"
        ws.cell(row=r, column=8, value=_supplier(it, suppliers))
        ws.cell(row=r, column=9, value="active" if it.is_active else "archived")
        r += 1
    ws.cell(row=r + 1, column=6, value="Total stock value").font = Font(bold=True)
    tot = ws.cell(row=r + 1, column=7, value=round(total, 2))
    tot.number_format = "#,##0.00"
    tot.font = Font(bold=True)
    for col, width in zip("ABCDEFGHI", [26, 16, 10, 8, 10, 12, 14, 18, 10], strict=False):
        ws.column_dimensions[col].width = width
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


# ── Waste log ────────────────────────────────────────────────────────────────
_WASTE_COLS = ["Date", "Item", "Qty", "Unit", "Unit cost", "Value", "Reason"]


def _title(date_from: date_type | None, date_to: date_type | None) -> str:
    if date_from and date_to:
        return f"Mise — Waste log ({date_from} to {date_to})"
    return "Mise — Waste log"


def _wdate(created) -> str:
    return created.date().isoformat() if hasattr(created, "date") else str(created)[:10]


def waste_to_csv(rows: list[dict], date_from=None, date_to=None) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([_title(date_from, date_to)])
    w.writerow([])
    w.writerow(_WASTE_COLS)
    total = Decimal("0")
    for r in rows:
        total += Decimal(str(r["value"]))
        w.writerow([
            _wdate(r["created_at"]), r["item_name"], str(r["quantity"]), r["unit"],
            str(r["unit_cost"]) if r["unit_cost"] is not None else "", str(r["value"]),
            r["reason"] or "",
        ])
    w.writerow([])
    w.writerow(["", "", "", "", "Total waste", str(total.quantize(_Q2))])
    return buf.getvalue().encode("utf-8")


def waste_to_xlsx(rows: list[dict], date_from=None, date_to=None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Waste log"
    ws.cell(row=1, column=1, value=_title(date_from, date_to)).font = Font(bold=True, size=14)
    for col, h in enumerate(_WASTE_COLS, start=1):
        ws.cell(row=3, column=col, value=h).font = Font(bold=True)
    r = 4
    total = 0.0
    for row in rows:
        total += float(row["value"])
        ws.cell(row=r, column=1, value=_wdate(row["created_at"]))
        ws.cell(row=r, column=2, value=row["item_name"])
        ws.cell(row=r, column=3, value=float(row["quantity"]))
        ws.cell(row=r, column=4, value=row["unit"])
        uc = float(row["unit_cost"]) if row["unit_cost"] is not None else None
        ws.cell(row=r, column=5, value=uc).number_format = "#,##0.00"
        ws.cell(row=r, column=6, value=float(row["value"])).number_format = "#,##0.00"
        ws.cell(row=r, column=7, value=row["reason"] or "")
        r += 1
    ws.cell(row=r + 1, column=5, value="Total waste").font = Font(bold=True)
    tot = ws.cell(row=r + 1, column=6, value=round(total, 2))
    tot.number_format = "#,##0.00"
    tot.font = Font(bold=True)
    for col, width in zip("ABCDEFG", [12, 26, 10, 10, 12, 14, 22], strict=False):
        ws.column_dimensions[col].width = width
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()
