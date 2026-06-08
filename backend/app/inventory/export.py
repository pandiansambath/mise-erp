"""CSV / Excel export for the inventory list."""
import csv
import io

from openpyxl import Workbook
from openpyxl.styles import Font

_HEADERS = ["Item", "Category", "Stock", "Unit", "Min stock", "Avg cost"]


def _row(it) -> list:
    return [
        it.name,
        it.category or "",
        str(it.current_stock),
        it.unit,
        str(it.min_stock_level) if it.min_stock_level is not None else "",
        str(it.average_cost),
    ]


def items_to_csv(items) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(_HEADERS)
    for it in items:
        w.writerow(_row(it))
    return buf.getvalue().encode("utf-8")


def items_to_xlsx(items) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Inventory"
    for col, h in enumerate(_HEADERS, start=1):
        ws.cell(row=1, column=col, value=h).font = Font(bold=True)
    for r, it in enumerate(items, start=2):
        ws.cell(row=r, column=1, value=it.name)
        ws.cell(row=r, column=2, value=it.category or "")
        ws.cell(row=r, column=3, value=float(it.current_stock))
        ws.cell(row=r, column=4, value=it.unit)
        ws.cell(
            row=r, column=5,
            value=float(it.min_stock_level) if it.min_stock_level is not None else None,
        )
        ws.cell(row=r, column=6, value=float(it.average_cost)).number_format = "#,##0.0000"
    ws.column_dimensions["A"].width = 28
    for c in ("B", "C", "D", "E", "F"):
        ws.column_dimensions[c].width = 14
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()
