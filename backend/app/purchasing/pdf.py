"""Branded purchase-order PDF via fpdf2 (currency code, latin-1 safe)."""
from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.core.pdf_logo import draw_hotel_logo
from app.hotels.prefs import pref

BRAND = (16, 185, 129)
DARK = (15, 23, 42)
MUTED = (100, 116, 139)
LIGHT = (241, 245, 249)


def _q(value, unit: str = "") -> str:
    """A quantity as a person writes it. Numeric(12,3) hands over "5.000", and
    a real user said it plainly: "no need like 1.5000, want like 1.5 kilo"."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return f"{value} {unit}".strip()
    txt = f"{n:.3f}".rstrip("0").rstrip(".") or "0"
    return f"{txt} {unit}".strip()


def _s(value) -> str:
    """latin-1-safe text for the built-in PDF font."""
    return str(value).encode("latin-1", "replace").decode("latin-1")


def generate_po_pdf(
    po, vendor_name: str, items: list[dict], hotel, *, received: bool = False
) -> bytes:
    # How this restaurant wants it grouped is theirs to choose, not ours to
    # decide — Settings -> "Group order PDFs by". Default is by category,
    # because that is what his users asked for.
    group_by = pref(hotel, "pdf_group_by")
    """The purchase order. `received=True` renders the GOODS RECEIVED NOTE instead: an
    extra 'Received' column beside 'Ordered' (short/over qty in red) + the receive note,
    so what was ordered vs what actually arrived stays on record."""
    cur = hotel.base_currency
    pdf = FPDF()
    pdf.add_page()

    # header band
    pdf.set_fill_color(*BRAND)
    pdf.rect(0, 0, 210, 30, style="F")
    pdf.set_text_color(255, 255, 255)
    name_x = 34 if draw_hotel_logo(pdf, hotel, x=13, y=6, height=18) else 14
    pdf.set_xy(name_x, 9)
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 9, text=_s(hotel.name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(name_x)
    pdf.set_font("Helvetica", "", 11)
    label = "GOODS RECEIVED NOTE" if received else "PURCHASE ORDER"
    pdf.cell(0, 6, text=f"{label}   |   {po.po_number}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # vendor block
    pdf.set_text_color(*DARK)
    pdf.set_xy(14, 40)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, text=_s(f"To: {vendor_name}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)

    # table header
    pdf.set_x(14)
    pdf.set_fill_color(*DARK)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 10)
    if received:
        pdf.cell(72, 9, text="  Item", fill=True)
        pdf.cell(24, 9, text="Ordered", align="R", fill=True)
        pdf.cell(24, 9, text="Received", align="R", fill=True)
        pdf.cell(30, 9, text="Unit price", align="R", fill=True)
        pdf.cell(
            32, 9, text="Line total  ", align="R", fill=True,
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )
    else:
        pdf.cell(86, 9, text="  Item", fill=True)
        pdf.cell(28, 9, text="Qty", align="R", fill=True)
        pdf.cell(34, 9, text="Unit price", align="R", fill=True)
        pdf.cell(
            34, 9, text="Line total  ", align="R", fill=True,
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )

    pdf.set_text_color(*DARK)
    pdf.set_font("Helvetica", "", 10)
    current_cat = None
    for i, it in enumerate(items):
        # A heading whenever the category changes. Real users' words: "PDF need
        # categorisation, like vegetables should be in one place". A flat
        # alphabetical list walks the picker back and forth across the store.
        cat = (it.get("category") or "Other").strip() or "Other"
        if group_by == "category" and cat != current_cat:
            current_cat = cat
            pdf.set_x(14)
            pdf.set_fill_color(*BRAND)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font("Helvetica", "B", 8)
            pdf.cell(
                182, 6, text=_s(f"  {cat.upper()}"), fill=True,
                new_x=XPos.LMARGIN, new_y=YPos.NEXT,
            )
            pdf.set_text_color(*DARK)
            pdf.set_font("Helvetica", "", 10)
        pdf.set_x(14)
        fill = i % 2 == 1
        pdf.set_fill_color(*LIGHT)
        if received:
            pdf.cell(72, 8, text=_s(f"  {it['item_name']}"), fill=fill)
            pdf.cell(24, 8, text=_q(it["ordered_qty"], it.get("unit", "")), align="R", fill=fill)
            if str(it["received_qty"]) != str(it["ordered_qty"]):
                pdf.set_text_color(200, 50, 50)  # short/over delivery stands out
            pdf.cell(24, 8, text=_q(it["received_qty"], it.get("unit", "")), align="R", fill=fill)
            pdf.set_text_color(*DARK)
            pdf.cell(30, 8, text=f"{cur} {it['unit_price']}", align="R", fill=fill)
            pdf.cell(
                32, 8, text=f"{cur} {it['line_total']}  ", align="R", fill=fill,
                new_x=XPos.LMARGIN, new_y=YPos.NEXT,
            )
        else:
            pdf.cell(86, 8, text=_s(f"  {it['item_name']}"), fill=fill)
            pdf.cell(28, 8, text=_q(it["ordered_qty"], it.get("unit", "")), align="R", fill=fill)
            pdf.cell(34, 8, text=f"{cur} {it['unit_price']}", align="R", fill=fill)
            pdf.cell(
                34, 8, text=f"{cur} {it['line_total']}  ", align="R", fill=fill,
                new_x=XPos.LMARGIN, new_y=YPos.NEXT,
            )

    pdf.set_x(14)
    pdf.set_fill_color(*BRAND)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 11)
    total_label_w = 150 if received else 148
    total_val_w = 32 if received else 34
    pdf.cell(total_label_w, 10, text="  Total (as ordered)" if received else "  Total", fill=True)
    pdf.cell(
        total_val_w, 10, text=f"{cur} {po.total_amount}  ", align="R", fill=True,
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )

    note = getattr(po, "receive_note", None)
    if received and note:
        pdf.ln(4)
        pdf.set_x(14)
        pdf.set_text_color(*DARK)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(
            0, 6, text="Delivery note (why received differs from ordered):",
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )
        pdf.set_x(14)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(182, 5, text=_s(note))

    pdf.set_text_color(*MUTED)
    pdf.set_xy(14, 280)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(
        0, 5, text="Generated by DineAI - restaurant intelligence",
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )
    return bytes(pdf.output())


def generate_consolidated_po_pdf(groups: list[dict], grand_total, hotel) -> bytes:
    """ONE document combining every open PO, grouped by vendor. Shows Ordered vs
    Received per line (partial deliveries in red), a subtotal per vendor, and a
    grand total across all vendors."""
    cur = hotel.base_currency
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    pdf.set_fill_color(*BRAND)
    pdf.rect(0, 0, 210, 30, style="F")
    pdf.set_text_color(255, 255, 255)
    name_x = 34 if draw_hotel_logo(pdf, hotel, x=13, y=6, height=18) else 14
    pdf.set_xy(name_x, 9)
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 9, text=_s(hotel.name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(name_x)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 6, text="CONSOLIDATED PURCHASE ORDER", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_text_color(*DARK)
    pdf.set_xy(14, 38)

    for g in groups:
        pdf.set_x(14)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(*DARK)
        pos = ", ".join(g["po_numbers"])
        pdf.cell(
            0, 8, text=_s(f"{g['vendor_name']}   ({pos})"),
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )

        pdf.set_x(14)
        pdf.set_fill_color(*DARK)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(78, 7, text="  Item", fill=True)
        pdf.cell(26, 7, text="Ordered", align="R", fill=True)
        pdf.cell(26, 7, text="Received", align="R", fill=True)
        pdf.cell(28, 7, text="Unit", align="R", fill=True)
        pdf.cell(24, 7, text="Total ", align="R", fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        pdf.set_text_color(*DARK)
        pdf.set_font("Helvetica", "", 9)
        for i, it in enumerate(g["items"]):
            pdf.set_x(14)
            fill = i % 2 == 1
            pdf.set_fill_color(*LIGHT)
            pdf.cell(78, 7, text=_s(f"  {it['item_name']}"), fill=fill)
            pdf.cell(26, 7, text=str(it["ordered_qty"]), align="R", fill=fill)
            if str(it["received_qty"]) != str(it["ordered_qty"]):
                pdf.set_text_color(200, 50, 50)
            pdf.cell(26, 7, text=str(it["received_qty"]), align="R", fill=fill)
            pdf.set_text_color(*DARK)
            pdf.cell(28, 7, text=f"{cur} {it['unit_price']}", align="R", fill=fill)
            pdf.cell(
                24, 7, text=f"{it['line_total']} ", align="R", fill=fill,
                new_x=XPos.LMARGIN, new_y=YPos.NEXT,
            )

        pdf.set_x(14)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*MUTED)
        pdf.cell(158, 7, text="Subtotal  ", align="R")
        pdf.cell(
            24, 7, text=f"{cur} {g['subtotal']} ", align="R",
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )
        pdf.ln(3)
        pdf.set_text_color(*DARK)

    pdf.set_x(14)
    pdf.set_fill_color(*BRAND)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(158, 11, text="  GRAND TOTAL (all vendors)", fill=True)
    pdf.cell(
        24, 11, text=f"{cur} {grand_total} ", align="R", fill=True,
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )

    pdf.set_text_color(*MUTED)
    pdf.ln(6)
    pdf.set_x(14)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(
        0, 5, text="Generated by DineAI - restaurant intelligence",
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )
    return bytes(pdf.output())
