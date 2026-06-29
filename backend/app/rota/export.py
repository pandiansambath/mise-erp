"""Excel export + import for the weekly rota.

Export: the week's shifts as a styled workbook. Template: an empty sheet with the
right headers + an example + the valid employee names. Import: parse a filled
template back into shift dicts (best-effort; never raises on bad cells)."""
import io
from datetime import date as date_type
from datetime import datetime, time, timedelta
from decimal import Decimal

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from app.core.xlsx_style import style_table

# Mise emerald brand for the PDF (RGB).
_BRAND = (5, 150, 105)    # emerald-600
_DARK = (6, 95, 70)       # emerald-900
_MUTED = (100, 116, 139)
_ZEBRA = (236, 253, 245)  # emerald-50
_TOTAL = (209, 250, 229)  # emerald-100

# Excel totals-row look (matches app/core/xlsx_style palette).
_X_TOTAL_BG = "D1FAE5"
_X_TITLE = "065F46"
_x_side = Side(style="thin", color="A7F3D0")
_X_BOX = Border(left=_x_side, right=_x_side, top=_x_side, bottom=_x_side)


def _ps(value) -> str:
    """latin-1 safe text for fpdf2 core fonts."""
    return str(value).encode("latin-1", "replace").decode("latin-1")


def _days(date_from: date_type, date_to: date_type) -> list[date_type]:
    """Every day in the range (capped at 14 so a stray range can't explode the grid)."""
    out: list[date_type] = []
    d = date_from
    while d <= date_to and len(out) < 14:
        out.append(d)
        d += timedelta(days=1)
    return out or [date_from]


def _pivot(shifts: list[dict]) -> dict:
    """Group shifts into an attendance-style grid: one entry per employee, with each
    day's shift time(s) and that employee's total hours."""
    emps: dict = {}
    for s in shifts:
        eid = s["employee_id"]
        e = emps.setdefault(
            eid, {"name": s["employee_name"], "cells": {}, "day_h": {}, "total": Decimal("0")}
        )
        d = s["date"]
        iso = d.isoformat() if hasattr(d, "isoformat") else str(d)
        txt = f'{s["start_time"].strftime("%H:%M")}-{s["end_time"].strftime("%H:%M")}'
        e["cells"][iso] = f'{e["cells"][iso]} / {txt}' if iso in e["cells"] else txt
        e["day_h"][iso] = e["day_h"].get(iso, Decimal("0")) + s["hours"]
        e["total"] += s["hours"]
    return emps


def _fmt_h(value: Decimal) -> str:
    """Tidy hours: 3.00 -> '3', 3.50 -> '3.5', 0 -> '0'."""
    s = f"{value:.2f}".rstrip("0").rstrip(".")
    return s or "0"


def rota_to_pdf(
    shifts: list[dict], hotel_name: str, date_from, date_to, emp_info: dict | None = None
) -> bytes:
    """A clean, branded weekly rota in the attendance-sheet grid: employees down the
    rows, days across the columns. Landscape so the whole week fits comfortably."""
    emp_info = emp_info or {}
    days = _days(date_from, date_to)
    emps = _pivot(shifts)
    ordered = sorted(emps.items(), key=lambda kv: kv[1]["name"].lower())

    pdf = FPDF(orientation="L")
    pdf.add_page()
    pw = pdf.w
    m = 12
    # Brand header band
    pdf.set_fill_color(*_BRAND)
    pdf.rect(0, 0, pw, 26, style="F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(m, 6)
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 8, text=_ps(hotel_name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(m)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(
        0, 5, text=_ps(f"WEEKLY ROTA   |   {date_from}  to  {date_to}"),
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )

    # Column geometry — names/role on the left, a column per day, total on the right.
    avail = pw - 2 * m
    name_w, id_w, role_w, total_w = 46, 20, 30, 22
    n_day = len(days)
    day_w = max(16.0, (avail - name_w - id_w - role_w - total_w) / n_day)

    pdf.set_xy(m, 32)
    pdf.set_fill_color(*_DARK)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(name_w, 11, text="  Employee", fill=True)
    pdf.cell(id_w, 11, text="Emp ID", align="C", fill=True)
    pdf.cell(role_w, 11, text="Role", align="C", fill=True)
    for d in days:
        pdf.cell(day_w, 11, text=_ps(d.strftime("%a %d/%m")), align="C", fill=True)
    pdf.cell(
        total_w, 11, text="Total h", align="C", fill=True,
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )

    pdf.set_text_color(*_DARK)
    pdf.set_font("Helvetica", "", 8)
    rh = 9
    daily = {d.isoformat(): Decimal("0") for d in days}
    grand = Decimal("0")
    if not ordered:
        pdf.set_x(m)
        pdf.cell(
            0, rh, text="  No shifts scheduled for this week.",
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )
    for i, (eid, e) in enumerate(ordered):
        code, title = emp_info.get(eid, ("", ""))
        fill = i % 2 == 1
        pdf.set_x(m)
        pdf.set_fill_color(*_ZEBRA)
        pdf.cell(name_w, rh, text=f"  {_ps(e['name'])}", fill=fill, border="B")
        pdf.cell(id_w, rh, text=_ps(code or "-"), align="C", fill=fill, border="B")
        pdf.cell(role_w, rh, text=_ps(title or "-"), align="C", fill=fill, border="B")
        for d in days:
            iso = d.isoformat()
            cell = _ps(e["cells"].get(iso, "-"))
            pdf.cell(day_w, rh, text=cell, align="C", fill=fill, border="B")
            daily[iso] += e["day_h"].get(iso, Decimal("0"))
        grand += e["total"]
        pdf.cell(
            total_w, rh, text=_ps(_fmt_h(e["total"])), align="C", fill=fill, border="B",
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )

    if ordered:
        pdf.set_x(m)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(*_TOTAL)
        pdf.set_text_color(*_DARK)
        pdf.cell(name_w + id_w + role_w, rh, text="  Daily total (hours)", fill=True)
        for d in days:
            pdf.cell(day_w, rh, text=_ps(_fmt_h(daily[d.isoformat()])), align="C", fill=True)
        pdf.cell(
            total_w, rh, text=_ps(_fmt_h(grand)), align="C", fill=True,
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )

    pdf.set_text_color(*_MUTED)
    pdf.set_y(pdf.h - 12)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(0, 5, text="Generated by Mise - every plate, every penny", align="C")
    return bytes(pdf.output())


def rota_to_xlsx(
    shifts: list[dict], date_from: date_type, date_to: date_type, emp_info: dict | None = None
) -> bytes:
    """Weekly rota as the attendance-sheet grid: employees down rows, days across
    columns, each employee's total hours, and a daily-totals row at the bottom."""
    emp_info = emp_info or {}
    days = _days(date_from, date_to)
    emps = _pivot(shifts)
    ordered = sorted(emps.items(), key=lambda kv: kv[1]["name"].lower())
    n_day = len(days)
    total_col = 3 + n_day + 1  # 1-based index of the "Total h" column

    wb = Workbook()
    ws = wb.active
    ws.title = "Rota"
    day_headers = [d.strftime("%a %d/%m") for d in days]
    headers = ["Employee", "Emp ID", "Role", *day_headers, "Total h"]

    daily = {d.isoformat(): Decimal("0") for d in days}
    grand = Decimal("0")
    r = 4
    for eid, e in ordered:
        code, title = emp_info.get(eid, ("", ""))
        ws.cell(row=r, column=1, value=e["name"])
        ws.cell(row=r, column=2, value=code or "")
        ws.cell(row=r, column=3, value=title or "")
        for j, d in enumerate(days):
            iso = d.isoformat()
            ws.cell(row=r, column=4 + j, value=e["cells"].get(iso, "—"))
            daily[iso] += e["day_h"].get(iso, Decimal("0"))
        ws.cell(row=r, column=total_col, value=float(e["total"]))
        grand += e["total"]
        r += 1

    style_table(
        ws, title="Mise — Weekly Rota", subtitle=f"{date_from} → {date_to}",
        headers=headers, n_rows=len(ordered),
        widths=[22, 10, 16, *([12] * n_day), 10], right_cols={total_col},
    )

    if not ordered:
        note = ws.cell(row=4, column=1, value="No shifts scheduled for this week.")
        note.font = Font(italic=True, color=_X_TITLE)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    # Center the day columns + Emp ID/Role (header + data) for a clean grid.
    for rr in range(3, 4 + len(ordered)):
        for col in range(4, 4 + n_day):
            ws.cell(row=rr, column=col).alignment = Alignment(
                horizontal="center", vertical="center"
            )
        ws.cell(row=rr, column=2).alignment = Alignment(horizontal="center")
        ws.cell(row=rr, column=3).alignment = Alignment(horizontal="center")

    # Daily-totals row (bold emerald on a light fill), matching the styler.
    tr = 4 + len(ordered)
    bold = Font(bold=True, color=_X_TITLE)
    fill = PatternFill("solid", fgColor=_X_TOTAL_BG)
    label = ws.cell(row=tr, column=1, value="Daily total (hours)")
    label.font, label.fill, label.border = bold, fill, _X_BOX
    for col in (2, 3):
        c = ws.cell(row=tr, column=col)
        c.fill, c.border = fill, _X_BOX
    for j, d in enumerate(days):
        c = ws.cell(row=tr, column=4 + j, value=float(daily[d.isoformat()]))
        c.font, c.fill, c.border = bold, fill, _X_BOX
        c.alignment = Alignment(horizontal="center")
    c = ws.cell(row=tr, column=total_col, value=float(grand))
    c.font, c.fill, c.border = bold, fill, _X_BOX
    c.alignment = Alignment(horizontal="right")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def template_xlsx(employee_names: list[str]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Rota"
    headers = ["Employee", "Date", "Start", "End", "Break (min)", "Notes"]
    ws.cell(row=4, column=1, value=employee_names[0] if employee_names else "Staff full name")
    ws.cell(row=4, column=2, value="2026-06-30")
    ws.cell(row=4, column=3, value="09:00")
    ws.cell(row=4, column=4, value="17:00")
    ws.cell(row=4, column=5, value=30)
    ws.cell(row=4, column=6, value="(optional)")
    style_table(
        ws, title="Mise — Rota template", headers=headers, n_rows=1,
        subtitle="Fill a row per shift, then upload. * Employee/Date/Start/End required.",
        widths=[26, 14, 10, 10, 12, 30], right_cols={5},
    )
    if employee_names:
        ws2 = wb.create_sheet("Employees")
        note = "Use these exact names in the Employee column:"
        ws2.cell(row=1, column=1, value=note).font = Font(bold=True)
        for i, n in enumerate(employee_names, start=2):
            ws2.cell(row=i, column=1, value=n)
        ws2.column_dimensions["A"].width = 28
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _parse_date(v) -> date_type | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date_type):
        return v
    s = str(v or "").strip()[:10]
    try:
        return date_type.fromisoformat(s)
    except ValueError:
        return None


def _parse_time(v) -> time | None:
    if isinstance(v, datetime):
        return v.time()
    if isinstance(v, time):
        return v
    s = str(v or "").strip()
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M%p", "%I%p"):
        try:
            return datetime.strptime(s.upper(), fmt).time()
        except ValueError:
            continue
    return None


def parse_rota_xlsx(file_bytes: bytes, max_rows: int = 500) -> list[dict]:
    """Filled template → [{employee_name, date, start_time, end_time, notes}]. Rows
    missing a name/date/start/end are skipped. Best-effort; bad files → []."""
    try:
        wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
    except Exception:  # noqa: BLE001 — unreadable file → nothing parsed
        return []

    start_idx = 0
    for i, row in enumerate(rows[:5]):
        if row and any(str(c or "").strip().lower() == "employee" for c in row):
            start_idx = i + 1
            break

    out: list[dict] = []
    for row in rows[start_idx:start_idx + max_rows]:
        if not row:
            continue
        name = str(row[0]).strip() if len(row) > 0 and row[0] else ""
        if not name:
            continue
        d = _parse_date(row[1]) if len(row) > 1 else None
        st = _parse_time(row[2]) if len(row) > 2 else None
        en = _parse_time(row[3]) if len(row) > 3 else None
        if not (d and st and en):
            continue
        notes = str(row[4]).strip() if len(row) > 4 and row[4] else None
        out.append({
            "employee_name": name, "date": d, "start_time": st, "end_time": en, "notes": notes,
        })
    return out
