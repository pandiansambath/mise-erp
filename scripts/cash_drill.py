"""Prove the till balances, against a real database.

The owner asked, fairly, to see this checked rather than be told it was tested:
I got the formula wrong on the first attempt — adding returned change on top of
the booked expense, which read 530 instead of 490 and would have shown the
drawer £40 richer than it was on every settled float.

So this runs his exact scenario through the REAL service code against the REAL
Postgres, on a throwaway hotel, and prints each stage next to what should
physically be in the box.

    opening 300, cash sales 200
    a staff member takes 50 for greens, spends 10, returns 40

**Everything happens inside ONE transaction that is ROLLED BACK.** Nothing is
written, so this is safe to run against production — which is the only place the
real schema and the real code exist together. A drill that needs its own
environment is a drill nobody runs.

    docker exec mise-backend-1 python /tmp/cash_drill.py
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

# Import every model that the ones below reference by foreign key. Without this
# SQLAlchemy's metadata has no `users` table and cannot resolve
# daily_sales.entered_by, which fails at flush rather than at import.
import app.auth.models  # noqa: F401
import app.purchasing.models  # noqa: F401
import app.vendors.models  # noqa: F401
from app.core.database import engine
from app.expenses.models import Expense, ExpenseCategory
from app.hotels.models import Hotel
from app.sales import cash, service
from app.sales.models import DailySales, PettyCash, SalesChannel, SalesLine

D = Decimal
DAY = date(2026, 1, 15)  # arbitrary; nothing else touches this hotel

passed = 0
failed = 0


def check(label: str, got: Decimal, want: Decimal, why: str) -> None:
    global passed, failed
    ok = got == want
    if ok:
        passed += 1
    else:
        failed += 1
    mark = "ok " if ok else "FAIL"
    print(f"  {mark} {label:34} expected {want:>7}  got {got:>7}   {why}")


async def drill(db: AsyncSession) -> None:
    hotel = Hotel(name="__cash drill__", country="GB", base_currency="GBP", city="London")
    db.add(hotel)
    await db.flush()

    channel = SalesChannel(hotel_id=hotel.id, name="Dine-in", commission_pct=D("0"))
    db.add(channel)
    category = ExpenseCategory(hotel_id=hotel.id, name="Produce", kind="VARIABLE")
    db.add(category)
    await db.flush()

    day = DailySales(hotel_id=hotel.id, date=DAY, opening_cash=D("300"))
    db.add(day)
    await db.flush()

    # £200 of CASH sales.
    db.add(
        SalesLine(
            daily_sales_id=day.id, channel_id=channel.id,
            gross_amount=D("200"), payment_method="CASH",
        )
    )
    await db.flush()

    print("\nSTAGE 1 — opening 300, cash sales 200. Nobody has touched the till.")
    summary = await service.day_summary(db, hotel.id, DAY)
    check("expected in drawer", summary["expected_cash"], D("500"), "300 + 200")

    print("\nSTAGE 2 — a staff member takes 50 for greens and leaves.")
    float_row = PettyCash(
        hotel_id=hotel.id, date=DAY, taken_amount=D("50"),
        purpose="greens", taken_by="Ravi",
    )
    db.add(float_row)
    await db.flush()
    summary = await service.day_summary(db, hotel.id, DAY)
    check("expected in drawer", summary["expected_cash"], D("450"), "the 50 is in his hand")
    check("petty still out", summary["drawer"]["petty_out"], D("50"), "shown as out, not lost")

    print("\nSTAGE 3 — he returns: spent 10, put 40 back. Settling books the spend.")
    expense = Expense(
        hotel_id=hotel.id, category_id=category.id, date=DAY,
        amount=D("10"), payment_method="CASH", description="greens",
    )
    db.add(expense)
    await db.flush()
    float_row.spent_amount = D("10")
    float_row.returned_amount = D("40")
    float_row.status = "SETTLED"
    float_row.expense_id = expense.id
    await db.flush()

    summary = await service.day_summary(db, hotel.id, DAY)
    check("expected in drawer", summary["expected_cash"], D("490"), "500 - the 10 actually spent")
    check("petty still out", summary["drawer"]["petty_out"], D("0"), "he is back")
    check("cash paid out", summary["drawer"]["cash_expenses"], D("10"), "the greens")

    print("\nSTAGE 4 — count the box. 490 is there, so the day balances.")
    day.cash_counted = D("490")
    await db.flush()
    summary = await service.day_summary(db, hotel.id, DAY)
    check("variance", summary["cash_variance"], D("0"), "a correct day reads as balanced")

    print("\nSTAGE 5 — a BANK payment of 500 must not move the till.")
    db.add(
        Expense(
            hotel_id=hotel.id, category_id=category.id, date=DAY,
            amount=D("500"), payment_method="BANK", description="rent",
        )
    )
    await db.flush()
    summary = await service.day_summary(db, hotel.id, DAY)
    check("expected in drawer", summary["expected_cash"], D("490"), "bank money is not till money")

    print("\nSTAGE 6 — tomorrow's opening carries from tonight's count.")
    carried = await cash.carried_opening(db, hotel.id, date(2026, 1, 16))
    check("carried opening", carried or D("-1"), D("490"), "no retyping, no typo")

    print("\nSTAGE 7 — an unreconciled float is surfaced, not absorbed.")
    bad = PettyCash(
        hotel_id=hotel.id, date=DAY, taken_amount=D("50"),
        spent_amount=D("10"), returned_amount=D("30"), status="SETTLED",
    )
    db.add(bad)
    await db.flush()
    rows = await cash.petty_for(db, hotel.id, DAY)
    gaps = cash.summarise_petty(rows)["unreconciled"]
    check(
        "unexplained amount",
        gaps[0]["difference"] if gaps else D("-1"),
        D("10"),
        "50 taken vs 10+30 accounted for",
    )


async def main() -> None:
    async with AsyncSession(engine) as db:
        try:
            await drill(db)
        finally:
            # Nothing is kept. The drill has to be safe to run anywhere, and the
            # only place the real schema and real code meet is production.
            await db.rollback()
    print(f"\n{passed} passed, {failed} failed")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
