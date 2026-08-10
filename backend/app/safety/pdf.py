"""Branded server-side PDF for the food-safety log (EHO audit trail). Replaces the
old browser window.print()."""
from fpdf.enums import XPos, YPos

from app.core.pdf import DARK, ZEBRA, branded_pdf, footer, ps, table_header

# The stored values are FRIDGE_TEMP, FREEZER_TEMP and so on. Printing the enum
# straight out put "FREEZER_TEMP" on an EHO document, which is both shouty and
# 20mm too wide for its column — it ran clean over the Item beside it, exactly
# the overflow the rota had. Say it the way a person says it.
_KIND = {
    "TEMP": "Temp",
    "CHECK": "Check",
    "FRIDGE_TEMP": "Fridge",
    "FREEZER_TEMP": "Freezer",
    "HOT_HOLD": "Hot hold",
    "PROBE": "Probe",
    "DELIVERY": "Delivery",
    "CLEANING": "Cleaning",
}


def _nice_kind(kind: str) -> str:
    """Fall back to Title Case rather than shouting an enum nobody defined here."""
    return _KIND.get(kind) or str(kind).replace("_", " ").capitalize()


def safety_log_pdf(hotel_name: str, date_from, date_to, logs: list) -> bytes:
    """logs: SafetyLog rows (date, kind, label, reading, status). Newest first."""
    pdf = branded_pdf(hotel_name, f"Food Safety Log   |   {date_from}  to  {date_to}")
    cols = [("Date", 26, "L"), ("Type", 28, "C"), ("Item", 78, "L"),
            ("Reading", 24, "R"), ("Status", 26, "C")]
    table_header(pdf, cols)

    if not logs:
        pdf.set_x(14)
        pdf.cell(0, 9, text="  No entries for this range.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        footer(pdf)
        return bytes(pdf.output())

    for i, log in enumerate(logs):
        reading = f"{log.reading}\xb0C" if log.reading is not None else "-"
        failed = str(log.status).upper() == "FAIL"
        # A failed check is the entire reason this document exists, and it was
        # set in the same grey as a pass. An environmental health officer should
        # not have to read every row to find the one that matters.
        fill = True if failed else i % 2 == 1
        if failed:
            pdf.set_fill_color(253, 232, 232)
        else:
            pdf.set_fill_color(*ZEBRA)
        pdf.set_x(14)
        pdf.cell(26, 8, text=ps(str(log.date)), fill=fill, border="B")
        pdf.cell(28, 8, text=ps(_nice_kind(log.kind)), align="C", fill=fill, border="B")
        pdf.cell(78, 8, text=f" {ps(log.label)}", fill=fill, border="B")
        pdf.cell(24, 8, text=ps(reading), align="R", fill=fill, border="B")
        if failed:
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(190, 40, 40)
        pdf.cell(
            26, 8, text=ps(log.status), align="C", fill=fill, border="B",
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )
        if failed:
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(*DARK)

    footer(pdf)
    return bytes(pdf.output())
