"""Branded server-side PDF for the food-safety log (EHO audit trail). Replaces the
old browser window.print()."""
from fpdf.enums import XPos, YPos

from app.core.pdf import ZEBRA, branded_pdf, footer, ps, table_header

_KIND = {"TEMP": "Temp", "CHECK": "Check"}


def safety_log_pdf(hotel_name: str, date_from, date_to, logs: list) -> bytes:
    """logs: SafetyLog rows (date, kind, label, reading, status). Newest first."""
    pdf = branded_pdf(hotel_name, f"Food Safety Log   |   {date_from}  to  {date_to}")
    cols = [("Date", 26, "L"), ("Type", 20, "C"), ("Item", 86, "L"),
            ("Reading", 24, "R"), ("Status", 26, "C")]
    table_header(pdf, cols)

    if not logs:
        pdf.set_x(14)
        pdf.cell(0, 9, text="  No entries for this range.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        footer(pdf)
        return bytes(pdf.output())

    for i, log in enumerate(logs):
        reading = f"{log.reading}\xb0C" if log.reading is not None else "-"
        fill = i % 2 == 1
        pdf.set_x(14)
        pdf.set_fill_color(*ZEBRA)
        pdf.cell(26, 8, text=ps(str(log.date)), fill=fill, border="B")
        pdf.cell(20, 8, text=ps(_KIND.get(log.kind, log.kind)), align="C", fill=fill, border="B")
        pdf.cell(86, 8, text=f" {ps(log.label)}", fill=fill, border="B")
        pdf.cell(24, 8, text=ps(reading), align="R", fill=fill, border="B")
        pdf.cell(
            26, 8, text=ps(log.status), align="C", fill=fill, border="B",
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )

    footer(pdf)
    return bytes(pdf.output())
