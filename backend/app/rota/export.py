"""Excel export + import for the weekly rota.

Export: the week's shifts as a styled workbook. Template: an empty sheet with the
right headers + an example + the valid employee names. Import: parse a filled
template back into shift dicts (best-effort; never raises on bad cells)."""
import io
from datetime import date as date_type
from datetime import datetime, time
from decimal import Decimal

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font


def rota_to_xlsx(shifts: list[dict], date_from: date_type, date_to: date_type) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Rota"
    title = f"Mise — Rota  {date_from} → {date_to}"
    ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=14)
    headers = ["Employee", "Date", "Start", "End", "Hours", "Notes"]
    for c, h in enumerate(headers, start=1):
        ws.cell(row=3, column=c, value=h).font = Font(bold=True)
    r = 4
    total = Decimal("0")
    for s in shifts:
        ws.cell(row=r, column=1, value=s["employee_name"])
        ws.cell(row=r, column=2, value=str(s["date"]))
        ws.cell(row=r, column=3, value=s["start_time"].strftime("%H:%M"))
        ws.cell(row=r, column=4, value=s["end_time"].strftime("%H:%M"))
        ws.cell(row=r, column=5, value=float(s["hours"]))
        ws.cell(row=r, column=6, value=s.get("notes") or "")
        total += s["hours"]
        r += 1
    ws.cell(row=r + 1, column=4, value="Total hours").font = Font(bold=True)
    ws.cell(row=r + 1, column=5, value=float(total)).font = Font(bold=True)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def template_xlsx(employee_names: list[str]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Rota"
    headers = ["Employee", "Date", "Start", "End", "Notes"]
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h).font = Font(bold=True)
    ws.cell(row=2, column=1, value=employee_names[0] if employee_names else "Staff full name")
    ws.cell(row=2, column=2, value="2026-06-30")
    ws.cell(row=2, column=3, value="09:00")
    ws.cell(row=2, column=4, value="17:00")
    ws.cell(row=2, column=5, value="(optional)")
    if employee_names:
        ws2 = wb.create_sheet("Employees")
        note = "Use these exact names in the Employee column:"
        ws2.cell(row=1, column=1, value=note).font = Font(bold=True)
        for i, n in enumerate(employee_names, start=2):
            ws2.cell(row=i, column=1, value=n)
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
