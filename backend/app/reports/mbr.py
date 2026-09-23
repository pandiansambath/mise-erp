"""The Monthly Business Report — everything about a period, in one document.

    "i need one consolidated super spceial export feature in pnl area that
     includes litrelly al thre details like expense , sales, money ectetc (for
     particluar days or whatever we choose)..let me give sample..refer that and
     u decorate urself"

His sample is `docs/Nirai_August_2026_Updated_MBR_v2.pdf`, and the shape of it
is the specification: not one P&L table, but a stack of TITLED SECTIONS, each
with its own total, and a Notes column that is allowed to say "not supplied"
rather than print a confident zero.

ONE SHAPE, FOUR RENDERERS. Every section is `{key, title, note, columns, rows,
total}`, so CSV, Excel, PDF and Word all walk the same structure instead of
each knowing what a vendor table looks like. Adding a section is one function
here and nothing anywhere else — which is the only way a report with this many
parts stays consistent across four formats.

⚠️ A MISSING NUMBER IS NOT A ZERO. His report says "Not supplied" and "Not
calculated" in three places, and that honesty is the most valuable thing in it:
a platform whose fee statement has not arrived must not be rendered as costing
nothing. Any cell we cannot work out is `None` here, and every renderer prints
an em dash for it rather than 0.00.

We cannot always match him, and where we cannot the report SAYS SO instead of
guessing — see the note on the platforms section, where a 0% channel is
genuinely ambiguous in our schema.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import Employee
from app.expenses.models import Expense, ExpenseCategory, ExpenseKind
from app.payroll.models import Payroll
from app.reports import service as reports_service
from app.sales.models import DailySales, SalesChannel, SalesLine
from app.sales.service import commission_for
from app.vendors.models import Vendor

_Q2 = Decimal("0.01")


@dataclass
class Section:
    """One titled table. `total` is a row appended in bold, or None."""

    key: str
    title: str
    columns: list[str]
    rows: list[list]
    note: str = ""
    total: list | None = None
    #: Which columns hold money, so a renderer can right-align and format them
    #: without guessing from the value's type.
    money_cols: list[int] = field(default_factory=list)


#: Every section, in the order his sample puts them, with the label shown in
#: the picker. The KEY is the API contract — the frontend sends these.
CATALOGUE: list[tuple[str, str]] = [
    ("summary", "The headline numbers"),
    ("platforms", "Delivery platforms — what they kept"),
    ("daily", "Day by day"),
    ("categories", "Where the money went, by category"),
    ("vendors", "Supplier payments"),
    ("staff", "Staff cost"),
    ("services", "Services & utilities"),
]
ALL_KEYS = [k for k, _ in CATALOGUE]


def _pct(part: Decimal, whole: Decimal) -> Decimal | None:
    if not whole:
        return None
    return (part / whole * 100).quantize(_Q2)


async def _summary(db, hotel_id, date_from, date_to, pnl: dict) -> Section:
    """Metric | Amount | Notes — the first thing anybody reads."""
    rows = [
        ["Gross sales", pnl["gross_sales"], "Everything rung up, before anyone took a cut"],
        ["Delivery commission", pnl["commission"], "What the platforms kept"],
        ["Net sales", pnl["net_sales"], "What actually reached the business"],
        ["Cost of sales", pnl["cost_of_sales"], "Food and the things that move with it"],
        ["Gross profit", pnl["gross_profit"], f"{pnl['gross_margin_pct']}% of net sales"],
        ["Operating expenses", pnl["operating_expenses"], "The costs that do not move with sales"],
        ["Net profit", pnl["net_profit"], f"{pnl['net_margin_pct']}% of net sales"],
    ]
    if pnl.get("waste_total"):
        rows.append(
            # NOT subtracted anywhere. The cost already landed when it was
            # bought, so showing it as an expense would count it twice.
            ["Logged waste", pnl["waste_total"], "Already inside cost of sales — shown, not added"]
        )
    return Section(
        key="summary",
        title="The headline numbers",
        columns=["Metric", "Amount", "Notes"],
        rows=rows,
        money_cols=[1],
    )


async def _platforms(db, hotel_id, date_from, date_to) -> Section:
    """Per channel: what was sold, what came back, and what that cost.

    The most useful page in his sample, and the one our own P&L flattened into
    a single "commission" line. A restaurant does not negotiate with "delivery
    commission"; it negotiates with Deliveroo.
    """
    rows_q = await db.execute(
        select(
            SalesChannel.name,
            SalesChannel.commission_pct,
            func.coalesce(func.sum(SalesLine.gross_amount), 0),
        )
        .join(SalesLine, SalesLine.channel_id == SalesChannel.id)
        .join(DailySales, SalesLine.daily_sales_id == DailySales.id)
        .where(
            DailySales.hotel_id == hotel_id,
            DailySales.date >= date_from,
            DailySales.date <= date_to,
        )
        .group_by(SalesChannel.name, SalesChannel.commission_pct)
        .order_by(func.coalesce(func.sum(SalesLine.gross_amount), 0).desc())
    )

    rows: list[list] = []
    t_gross = t_net = t_cut = Decimal("0")
    for name, pct, gross in rows_q.all():
        gross = Decimal(gross or 0)
        cut = commission_for(gross, pct)
        net = gross - cut
        rows.append([name, gross, net, cut, _pct(cut, gross)])
        t_gross += gross
        t_net += net
        t_cut += cut

    return Section(
        key="platforms",
        title="Delivery platforms — what they kept",
        columns=["Platform", "Gross sales", "Received", "Their cut", "Effective %"],
        rows=rows,
        note=(
            # ⚠️ 0% IS TWO DIFFERENT ANSWERS AND WE CANNOT TELL THEM APART.
            # `commission_pct` is NOT NULL with a default of 0, so a channel
            # nobody has entered a rate for is indistinguishable from cash,
            # which genuinely costs nothing. His own report writes "Not
            # supplied" for the first case and I cannot, so the caveat is
            # printed instead of a number I would be inventing.
            "Worked out from the commission rate recorded against each channel. "
            "A channel at 0% has no rate recorded: for cash and walk-in that is "
            "correct, but for a delivery platform it usually means the rate has "
            "not been entered yet."
        ),
        total=["TOTAL", t_gross, t_net, t_cut, _pct(t_cut, t_gross)],
        money_cols=[1, 2, 3],
    )


async def _daily(db, hotel_id, date_from, date_to) -> Section:
    """Day by day, so an arbitrary range is readable rather than a single figure."""
    days = await reports_service.sales_trend(db, hotel_id, date_from, date_to)
    # `daily_net` hands back strings, so they are converted HERE rather than
    # in four renderers that would each have to guess.
    rows = [[d["date"], Decimal(d["net"])] for d in days]
    total = sum((r[1] for r in rows), Decimal("0"))
    return Section(
        key="daily",
        title="Day by day",
        columns=["Date", "Net sales"],
        rows=rows,
        total=["TOTAL", total],
        money_cols=[1],
    )


async def _categories(db, hotel_id, date_from, date_to, pnl: dict) -> Section:
    rows = [
        [c["category_name"], c["kind"].title(), c["total"]] for c in pnl["expense_breakdown"]
    ]
    rows.sort(key=lambda r: r[2], reverse=True)
    total = sum((r[2] for r in rows), Decimal("0"))
    return Section(
        key="categories",
        title="Where the money went, by category",
        columns=["Category", "Kind", "Total"],
        rows=rows,
        total=["TOTAL", "", total],
        money_cols=[2],
    )


async def _vendors(db, hotel_id, date_from, date_to) -> Section:
    q = await db.execute(
        select(Vendor.name, func.coalesce(func.sum(Expense.amount), 0))
        .join(Expense, Expense.vendor_id == Vendor.id)
        .where(
            Expense.hotel_id == hotel_id,
            Expense.date >= date_from,
            Expense.date <= date_to,
        )
        .group_by(Vendor.name)
        .order_by(func.coalesce(func.sum(Expense.amount), 0).desc())
    )
    rows = [[name, Decimal(amt or 0)] for name, amt in q.all()]
    return Section(
        key="vendors",
        title="Supplier payments",
        columns=["Supplier", "Paid"],
        rows=rows,
        note="Only costs with a supplier attached. Anything unattached is in the category table.",
        total=["TOTAL", sum((r[1] for r in rows), Decimal("0"))],
        money_cols=[1],
    )


async def _staff(db, hotel_id, date_from, date_to) -> Section:
    """What each person was actually paid for payroll runs inside the period.

    ⚠️ OVERLAP, NOT CONTAINMENT — the same rule the leave list uses. A monthly
    run that starts before the window and ends inside it is pay that belongs to
    this period, and requiring containment would silently drop it.
    """
    q = await db.execute(
        select(Employee.full_name, func.coalesce(func.sum(Payroll.net_pay), 0))
        .join(Payroll, Payroll.employee_id == Employee.id)
        .where(
            Payroll.hotel_id == hotel_id,
            Payroll.status != "DRAFT",
            func.coalesce(Payroll.period_start, date_from) <= date_to,
            func.coalesce(Payroll.period_end, date_to) >= date_from,
        )
        .group_by(Employee.full_name)
        .order_by(func.coalesce(func.sum(Payroll.net_pay), 0).desc())
    )
    rows = [[name, Decimal(amt or 0)] for name, amt in q.all()]
    return Section(
        key="staff",
        title="Staff cost",
        columns=["Person", "Paid"],
        rows=rows,
        note="Payroll runs overlapping this period. Drafts are not counted.",
        total=["TOTAL", sum((r[1] for r in rows), Decimal("0"))],
        money_cols=[1],
    )


async def _services(db, hotel_id, date_from, date_to) -> Section:
    """The standing bills: fixed costs with no supplier behind them."""
    q = await db.execute(
        select(ExpenseCategory.name, func.coalesce(func.sum(Expense.amount), 0))
        .join(ExpenseCategory, Expense.category_id == ExpenseCategory.id)
        .where(
            Expense.hotel_id == hotel_id,
            Expense.date >= date_from,
            Expense.date <= date_to,
            Expense.vendor_id.is_(None),
            ExpenseCategory.kind == ExpenseKind.FIXED.value,
        )
        .group_by(ExpenseCategory.name)
        .order_by(func.coalesce(func.sum(Expense.amount), 0).desc())
    )
    rows = [[name, Decimal(amt or 0)] for name, amt in q.all()]
    return Section(
        key="services",
        title="Services & utilities",
        columns=["Service", "Amount"],
        rows=rows,
        total=["TOTAL", sum((r[1] for r in rows), Decimal("0"))],
        money_cols=[1],
    )


async def build(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    date_from: date_type,
    date_to: date_type,
    want: list[str] | None = None,
    *,
    hotel_name: str = "",
    currency: str = "GBP",
) -> dict:
    """The whole report, or only the sections asked for.

        "have a cusotmised feature like ask user whther to iunclude tis
         calcuateion or not or leave empty to keep default whihc give all the
         consoldiated things as our sampe report"

    EMPTY MEANS EVERYTHING. Asking for nothing is how somebody says "just give
    me the usual", not how they ask for a blank document.
    """
    chosen = [k for k in ALL_KEYS if k in set(want)] if want else ALL_KEYS

    pnl = await reports_service.pnl(db, hotel_id, date_from, date_to)
    out: list[Section] = []
    for key in chosen:
        if key == "summary":
            out.append(await _summary(db, hotel_id, date_from, date_to, pnl))
        elif key == "platforms":
            out.append(await _platforms(db, hotel_id, date_from, date_to))
        elif key == "daily":
            out.append(await _daily(db, hotel_id, date_from, date_to))
        elif key == "categories":
            out.append(await _categories(db, hotel_id, date_from, date_to, pnl))
        elif key == "vendors":
            out.append(await _vendors(db, hotel_id, date_from, date_to))
        elif key == "staff":
            out.append(await _staff(db, hotel_id, date_from, date_to))
        elif key == "services":
            out.append(await _services(db, hotel_id, date_from, date_to))

    return {
        "hotel_name": hotel_name,
        "date_from": date_from,
        "date_to": date_to,
        "currency": currency,
        "sections": out,
    }
