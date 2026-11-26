"""Branded PDF payslip via fpdf2 (currency code, latin-1 safe)."""
import re
from decimal import Decimal

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.core.pdf import money
from app.core.pdf_logo import draw_hotel_logo
from app.payroll.engine import slip_range
from app.payroll.periods import say_day, say_range

BRAND = (16, 185, 129)  # emerald
DARK = (15, 23, 42)  # slate-900
MUTED = (100, 116, 139)  # slate-500
LIGHT = (241, 245, 249)  # slate-100


def _s(value) -> str:
    """Make text safe for the built-in latin-1 PDF font (avoids 500s on stray
    unicode like em-dashes or non-latin names). TODO: embed a Unicode TTF."""
    return str(value).encode("latin-1", "replace").decode("latin-1")


METHOD_WORDS = {"CASH": "cash", "BANK": "bank transfer", "CARD": "card"}


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-")


def file_name(payroll, employee) -> str:
    """A name every browser and mail server takes.

    A custom run's label has an arrow in it, and an arrow in a Content-Disposition
    header is a 500: nobody paid by custom dates could ever open their payslip.
    """
    start, end = slip_range(payroll)
    return safe_name(f"payslip-{employee.employee_code or 'staff'}-{start}-to-{end}") + ".pdf"


def _draw(pdf: FPDF, payroll, employee, hotel, adjustments=()) -> None:
    """Render ONE payslip page onto `pdf` (reused for single + consolidated)."""
    cur = hotel.base_currency
    period = say_range(*slip_range(payroll))
    pdf.add_page()

    # ── header band ──
    pdf.set_fill_color(*BRAND)
    pdf.rect(0, 0, 210, 30, style="F")
    pdf.set_text_color(255, 255, 255)
    name_x = 34 if draw_hotel_logo(pdf, hotel, x=13, y=6, height=18) else 14
    pdf.set_xy(name_x, 9)
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 9, text=_s(hotel.name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(name_x)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 6, text=_s(f"PAYSLIP   |   {period}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # ── employee block ──
    pdf.set_text_color(*DARK)
    pdf.set_xy(14, 40)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, text=_s(employee.full_name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(14)
    pdf.set_text_color(*MUTED)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(
        0, 6,
        text=_s(f"{employee.employee_code}   |   {employee.job_title or 'Staff'}"),
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )
    pdf.set_x(14)
    # "5.50" on a payslip is the one place a decimal hour is most likely to be
    # misread as five hours fifty minutes. Spell it out.
    _th = payroll.minutes or int(
        (Decimal(str(payroll.total_hours or 0)) * 60).to_integral_value()
    )
    _hh, _mm = divmod(max(_th, 0), 60)
    _hours = f"{_hh}h {_mm}m" if _mm else f"{_hh}h"
    _days = str(payroll.days_present)
    if payroll.half_days:
        _days += f" and {payroll.half_days} half"
    meta = f"Days: {_days}    Hours: {_hours}"
    if payroll.rate and payroll.pay_type:
        meta += "    Rate: " + money(payroll.rate, cur) + (
            " an hour" if payroll.pay_type == "HOURLY" else " a month"
        )
    if employee.ni_number:
        meta += f"    NI: {employee.ni_number}"
    pdf.cell(0, 6, text=_s(meta), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # ── earnings / deductions table ──
    pdf.ln(6)

    def line(label: str, value: str, *, shade: bool = False, net: bool = False) -> None:
        pdf.set_x(14)
        if net:
            pdf.set_fill_color(*BRAND)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font("Helvetica", "B", 12)
            fill = True
        else:
            pdf.set_fill_color(*LIGHT)
            pdf.set_text_color(*DARK)
            pdf.set_font("Helvetica", "", 11)
            fill = shade
        pdf.cell(122, 9, text=f"  {label}", border=0, fill=fill)
        pdf.cell(
            60, 9, text=f"{value}  ", align="R", fill=fill,
            new_x=XPos.LMARGIN, new_y=YPos.NEXT,
        )

    # Every line that makes up the net, and nothing that does not: overtime is
    # INSIDE gross, so it is said about it rather than listed under it.
    rows: list[tuple[str, str]] = [("Gross pay", money(payroll.gross_pay, cur))]
    if payroll.overtime_pay:
        rows[0] = (
            f"Gross pay (of which overtime {money(payroll.overtime_pay, cur)})", rows[0][1],
        )
    for a in adjustments:
        sign = "- " if a.amount < 0 else "+ "
        rows.append((a.label, sign + money(abs(a.amount), cur)))
    listed = sum((-a.amount for a in adjustments if a.amount < 0), Decimal("0"))
    if payroll.other_deductions != listed:
        # From before each deduction had a name.
        rows.append(("Other deductions", "- " + money(payroll.other_deductions - listed, cur)))
    rows.append(("Advance taken back", "- " + money(payroll.advance_deduction, cur)))
    for i, (label, value) in enumerate(rows):
        line(_s(label), value, shade=i % 2 == 0)
    pdf.ln(2)
    line("NET PAY", money(payroll.net_pay, cur), net=True)
    if payroll.status == "PAID" and payroll.paid_on:
        how = METHOD_WORDS.get(payroll.paid_method or "", "")
        words = f"Paid on {say_day(payroll.paid_on)}"
        if how:
            words += f" by {how}"
        if payroll.paid_reference:
            words += f", reference {payroll.paid_reference}"
        pdf.ln(3)
        pdf.set_x(14)
        pdf.set_text_color(*MUTED)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 6, text=_s(words), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # ── footer ──
    pdf.set_text_color(*MUTED)
    # y=280 on A4 is below fpdf's bottom margin, so writing the footer there
    # started a fresh page to hold it — the blank last sheet again, this being
    # the fourth file with its own footer and therefore its own copy of it.
    pdf.set_auto_page_break(False)
    pdf.set_xy(14, 280)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(
        0, 5,
        text=f"Status: {payroll.status}   |   Generated by DineAI - restaurant intelligence",
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )


def generate_payslip(payroll, employee, hotel, adjustments=()) -> bytes:
    """A single employee's payslip PDF."""
    pdf = FPDF()
    _draw(pdf, payroll, employee, hotel, adjustments)
    return bytes(pdf.output())


def generate_consolidated(items, hotel, adjustments: dict | None = None) -> bytes:
    """One PDF containing every payslip for a period — the super-admin's run summary.
    `items` is a list of (payroll, employee) pairs; `adjustments` is keyed on the
    payslip's id."""
    pdf = FPDF()
    for payroll, employee in items:
        _draw(pdf, payroll, employee, hotel, (adjustments or {}).get(payroll.id, ()))
    if not items:
        pdf.add_page()
        pdf.set_font("Helvetica", "", 12)
        pdf.cell(0, 10, text="No payroll for this period.")
    return bytes(pdf.output())
