"""Branded server-side PDFs for recipes: a party-order quote and the allergen sheet.
Replaces the old browser window.print() (which captured the whole screen)."""
from fpdf.enums import XPos, YPos

from app.core.pdf import DARK, TOTAL, ZEBRA, branded_pdf, footer, ps, table_header

# UK 14 declarable allergens — codes → labels (mirrors frontend lib/allergens.ts).
ALLERGEN_LABEL = {
    "gluten": "Cereals (gluten)", "crustaceans": "Crustaceans", "eggs": "Eggs",
    "fish": "Fish", "peanuts": "Peanuts", "soya": "Soya", "milk": "Milk",
    "nuts": "Tree nuts", "celery": "Celery", "mustard": "Mustard", "sesame": "Sesame",
    "sulphites": "Sulphites", "lupin": "Lupin", "molluscs": "Molluscs",
}


def _money(sym: str, value) -> str:
    return f"{sym}{float(value):,.2f}"


def party_quote_pdf(
    hotel_name: str, customer: str, when: str, currency: str, lines: list[dict]
) -> bytes:
    """lines: [{name, qty, unit_price (or None), unit_cost}]. Renders a costed,
    branded quote with per-line price/cost/profit and the totals + margin."""
    pdf = branded_pdf(hotel_name, "Party Order Quote")
    sym = currency or "GBP "

    pdf.set_font("Helvetica", "", 10)
    meta = []
    if customer:
        meta.append(f"Customer / party: {customer}")
    if when:
        meta.append(f"Date: {when}")
    for line in meta:
        pdf.set_x(14)
        pdf.cell(0, 6, text=ps(line), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)

    cols = [("Dish", 78, "L"), ("Qty", 18, "C"), ("Price", 28, "R"),
            ("Cost", 28, "R"), ("Profit", 30, "R")]
    table_header(pdf, cols)

    total_price = total_cost = 0.0
    any_unpriced = False
    for i, ln in enumerate(lines):
        qty = int(ln.get("qty") or 0)
        unit_cost = float(ln.get("unit_cost") or 0)
        cost = unit_cost * qty
        has_price = ln.get("unit_price") is not None
        price = float(ln["unit_price"]) * qty if has_price else 0.0
        profit = price - cost
        total_price += price
        total_cost += cost
        any_unpriced = any_unpriced or not has_price
        fill = i % 2 == 1
        pdf.set_x(14)
        pdf.set_fill_color(*ZEBRA)
        price_txt = _money(sym, price) if has_price else "-"
        profit_txt = _money(sym, profit) if has_price else "-"
        pdf.cell(78, 8, text=f" {ps(ln.get('name') or '-')}", fill=fill, border="B")
        pdf.cell(18, 8, text=str(qty), align="C", fill=fill, border="B")
        pdf.cell(28, 8, text=price_txt, align="R", fill=fill, border="B")
        pdf.cell(28, 8, text=_money(sym, cost), align="R", fill=fill, border="B")
        pdf.cell(
            30, 8, text=profit_txt, align="R", fill=fill,
            border="B", new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )

    profit = total_price - total_cost
    margin = (profit / total_price * 100) if total_price > 0 else 0.0
    pdf.set_x(14)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(*TOTAL)
    pdf.cell(96, 9, text="  Totals", fill=True)
    pdf.cell(28, 9, text=_money(sym, total_price), align="R", fill=True)
    pdf.cell(28, 9, text=_money(sym, total_cost), align="R", fill=True)
    pdf.cell(30, 9, text=_money(sym, profit), align="R", fill=True,
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)
    pdf.set_x(14)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, text=ps(f"Margin: {margin:.1f}%"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if any_unpriced:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_x(14)
        pdf.multi_cell(
            0, 5,
            text=ps("Some dishes have no selling price set, so the total price/profit "
                    "excludes them. Set prices on Recipes for a complete quote."),
        )
    footer(pdf)
    return bytes(pdf.output())


def allergen_pdf(hotel_name: str, rows: list[dict]) -> bytes:
    """rows: [{name, allergens (codes), unreviewed (names)}] → a clean per-dish sheet."""
    pdf = branded_pdf(hotel_name, "Allergen Matrix - UK Natasha's Law")
    if not rows:
        pdf.set_font("Helvetica", "", 11)
        pdf.set_x(14)
        pdf.cell(0, 8, text="No recipes yet.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        footer(pdf)
        return bytes(pdf.output())

    for r in rows:
        pdf.set_x(14)
        pdf.set_text_color(*DARK)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, text=ps(r.get("name") or "-"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        codes = r.get("allergens") or []
        labels = [ALLERGEN_LABEL.get(c, c) for c in codes]
        pdf.set_x(16)
        pdf.set_font("Helvetica", "", 10)
        if labels:
            pdf.multi_cell(0, 5, text=ps("Contains: " + ", ".join(labels)))
        else:
            pdf.multi_cell(0, 5, text=ps("No listed allergens"))
        unreviewed = r.get("unreviewed") or []
        if unreviewed:
            pdf.set_x(16)
            pdf.set_font("Helvetica", "I", 9)
            pdf.multi_cell(
                0, 5, text=ps("Not reviewed: " + ", ".join(unreviewed) + " - tag on Inventory."),
            )
        pdf.ln(2)

    pdf.ln(2)
    pdf.set_x(14)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(
        0, 4,
        text=ps("The 14 declarable allergens: " + ", ".join(ALLERGEN_LABEL.values()) + "."),
    )
    footer(pdf)
    return bytes(pdf.output())
