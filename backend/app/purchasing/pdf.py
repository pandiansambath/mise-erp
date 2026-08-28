"""Branded purchase-order PDF via fpdf2 (currency code, latin-1 safe)."""
from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.core.pdf_logo import draw_hotel_logo
from app.hotels.prefs import pref

BRAND = (16, 185, 129)
DARK = (15, 23, 42)
MUTED = (100, 116, 139)
LIGHT = (241, 245, 249)


def _qty(it: dict, key: str) -> str:
    """What to print in a quantity column.

    "if we order 1 pack (which is 10kg) then in the PDF we need to see 1 pack."
    The order is STORED in base units, so a ten-kilo pack is kept as 10 and was
    printed as "10 kg" — the same amount, and the wrong instruction for the
    person filling it. `ordered_as` carries the pack wording when the quantity
    divides evenly into one; otherwise we fall back to the base units, which is
    honest rather than rounded.
    """
    packed = it.get(f"{key.split('_')[0]}_as")
    if packed:
        return str(packed)
    return _q(it.get(key), it.get("unit", ""))


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
    # No currency on this document any more: the PO carries what to bring,
    # not what it costs.
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
    # NO PRICES. His instruction, and it is the right one for a document that
    # goes to a supplier to be FILLED: what they need is what to bring. The
    # money lives in the app, where it can be checked against the invoice.
    if received:
        pdf.cell(110, 9, text="  Item", fill=True)
        pdf.cell(36, 9, text="Ordered", align="R", fill=True)
        pdf.cell(
            36, 9, text="Received  ", align="R", fill=True,
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )
    else:
        pdf.cell(140, 9, text="  Item", fill=True)
        pdf.cell(
            42, 9, text="Quantity  ", align="R", fill=True,
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
            pdf.cell(110, 8, text=_s(f"  {it['item_name']}"), fill=fill)
            pdf.cell(36, 8, text=_s(_qty(it, "ordered_qty")), align="R", fill=fill)
            if str(it["received_qty"]) != str(it["ordered_qty"]):
                pdf.set_text_color(200, 50, 50)  # short/over delivery stands out
            pdf.cell(
                36, 8, text=_s(_qty(it, "received_qty") + "  "), align="R", fill=fill,
                new_x=XPos.LMARGIN, new_y=YPos.NEXT,
            )
            pdf.set_text_color(*DARK)
        else:
            pdf.cell(140, 8, text=_s(f"  {it['item_name']}"), fill=fill)
            pdf.cell(
                42, 8, text=_s(_qty(it, "ordered_qty") + "  "), align="R", fill=fill,
                new_x=XPos.LMARGIN, new_y=YPos.NEXT,
            )

    # A line count rather than a money total. The prices are deliberately not on
    # this document, so a total would be the only figure on it and the most
    # confusing one — a number with nothing to add up to.
    pdf.set_x(14)
    pdf.set_fill_color(*BRAND)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(140 if not received else 110, 10, text=f"  {len(items)} items", fill=True)
    pdf.cell(
        42 if not received else 72, 10, text="  ", align="R", fill=True,
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
