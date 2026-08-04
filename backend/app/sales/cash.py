"""What should be in the till, and why it isn't.

The owner's line: *no money should get lost*. That only works if the expected
figure accounts for every way cash actually moves, so:

    expected = opening
             + cash sales
             - cash expenses          (someone paid a supplier from the till)
             - petty cash still out   (someone is out buying greens)
             + petty cash returned    (they came back with the change)

The old sum was `opening + cash sales`. Everything else was invisible, so a
correctly-run day looked short and the count never balanced — which teaches
people to stop trusting the number, which is worse than not showing it.

Two rules this module exists to enforce:

**Only CASH touches the drawer.** A card sale or a bank-paid invoice changes the
business's money but not the box on the counter. Mixing them is the most common
way tills "don't balance".

**Money out and money spent are different facts.** Someone takes 50 and spends
10. The drawer is 50 light until they return; the business only lost 10. A
single figure cannot express that, so `taken`, `spent` and `returned` are held
apart and only reconciled when the person is back.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.expenses.models import Expense
from app.sales.models import CashEvent, DailySales, PettyCash

ZERO = Decimal("0")


async def cash_expenses_for(db: AsyncSession, hotel_id: uuid.UUID, day: date_type) -> Decimal:
    """Expenses paid from the till that day. Card and bank do not touch it."""
    rows = await db.execute(
        select(Expense.amount).where(
            Expense.hotel_id == hotel_id,
            Expense.date == day,
            Expense.payment_method == "CASH",
        )
    )
    return sum((r[0] or ZERO for r in rows.all()), ZERO)


async def petty_for(db: AsyncSession, hotel_id: uuid.UUID, day: date_type) -> list[PettyCash]:
    rows = await db.execute(
        select(PettyCash)
        .where(PettyCash.hotel_id == hotel_id, PettyCash.date == day)
        .order_by(PettyCash.created_at)
    )
    return list(rows.scalars())


def summarise_petty(rows: list[PettyCash]) -> dict:
    """Split petty cash into what is still out and what came back.

    An OPEN float is money missing from the drawer with nothing yet to show for
    it. A SETTLED one has become an expense (the spend) plus returned change,
    and those two must add back to what was taken or somebody is out of pocket.
    """
    out = ZERO            # taken and not yet accounted for
    spent = ZERO          # genuinely gone
    returned = ZERO       # change put back in the box
    spent_unbooked = ZERO # spent, but with no expense row to account for it
    unreconciled: list[dict] = []

    for r in rows:
        if r.status == "OPEN":
            out += r.taken_amount or ZERO
            continue
        s = r.spent_amount or ZERO
        ret = r.returned_amount or ZERO
        spent += s
        returned += ret
        # Settling normally books the spend as a CASH expense, and that expense
        # already removes it from the drawer. When it did NOT (no category was
        # chosen), the money is still gone and has to be taken off here instead
        # — otherwise the till reads high by exactly the amount spent.
        if r.expense_id is None:
            spent_unbooked += s
        # taken must equal spent + returned. A mismatch is not an error to
        # swallow — it is the exact thing the owner wants surfaced.
        diff = (r.taken_amount or ZERO) - s - ret
        if diff != ZERO:
            unreconciled.append(
                {
                    "id": r.id,
                    "taken_by": r.taken_by,
                    "purpose": r.purpose,
                    "taken": r.taken_amount,
                    "spent": s,
                    "returned": ret,
                    "difference": diff,
                }
            )

    return {
        "still_out": out,
        "spent": spent,
        "returned": returned,
        "spent_unbooked": spent_unbooked,
        "unreconciled": unreconciled,
    }


async def drawer_for(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    day: date_type,
    *,
    opening: Decimal,
    cash_sales: Decimal,
    counted: Decimal | None,
) -> dict:
    """The full cash picture for a day, with every line shown.

    Returns the workings, not just the answer: when a till is short, "expected
    480, counted 455" is an accusation, while showing which parts made up the
    480 is something a manager can actually check.
    """
    spent_cash = await cash_expenses_for(db, hotel_id, day)
    petty = summarise_petty(await petty_for(db, hotel_id, day))

    # Work it through with his greens example: opening 300, cash sales 200, a
    # staff member takes 50, spends 10, returns 40. The box holds 490 at the end.
    #
    #   OPEN float      the whole 50 is out of the drawer      -> 500 - 50 = 450
    #   SETTLED float   only the 10 actually spent is gone     -> 500 - 10 = 490
    #
    # For a settled float the net effect on the drawer is exactly the SPEND
    # (taken out, change back in), and settling books that spend as a cash
    # expense — so it is already inside spent_cash. Adding the returned change
    # back on top would count it twice and read 530: the drawer would look
    # 40 richer than it is, every single time.
    #
    # The one gap: if settling booked no expense (no category chosen), that
    # spend is in no other total, so `spent_unbooked` carries it here.
    expected = opening + cash_sales - spent_cash - petty["still_out"] - petty["spent_unbooked"]

    return {
        "opening": opening,
        "cash_sales": cash_sales,
        "cash_expenses": spent_cash,
        "petty_out": petty["still_out"],
        "petty_returned": petty["returned"],
        "expected": expected,
        "counted": counted,
        "variance": (counted - expected) if counted is not None else None,
        "unreconciled": petty["unreconciled"],
    }


async def record_change(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    day: date_type,
    field: str,
    old: Decimal | None,
    new: Decimal | None,
    *,
    user_id: uuid.UUID | None = None,
    reason: str | None = None,
    source: str = "user",
) -> None:
    """Append one line to the cash history. Never updates, never deletes.

    Called for every change to an opening or closing figure. A no-op change is
    not recorded — a history full of "500 → 500" is noise that hides the one
    line that matters.
    """
    if old == new:
        return
    db.add(
        CashEvent(
            hotel_id=hotel_id,
            date=day,
            field=field,
            old_value=old,
            new_value=new,
            reason=reason,
            changed_by=user_id,
            source=source,
        )
    )


async def history_for(db: AsyncSession, hotel_id: uuid.UUID, day: date_type) -> list[CashEvent]:
    """Newest first — when checking a suspicious figure you want the last change,
    not the first."""
    rows = await db.execute(
        select(CashEvent)
        .where(CashEvent.hotel_id == hotel_id, CashEvent.date == day)
        .order_by(CashEvent.created_at.desc())
    )
    return list(rows.scalars())


async def carried_opening(
    db: AsyncSession, hotel_id: uuid.UUID, day: date_type
) -> Decimal | None:
    """Yesterday's closing count, which is today's opening float.

    Whatever was in the drawer last night is in it this morning; making someone
    retype it invites a typo into the one number the whole day is measured from.

    Returns None when the previous day was never counted — guessing there would
    silently invent a float, and a wrong opening makes every later figure wrong.
    """
    prev = day.fromordinal(day.toordinal() - 1)
    row = await db.execute(
        select(DailySales.cash_counted).where(
            DailySales.hotel_id == hotel_id, DailySales.date == prev
        )
    )
    return row.scalar_one_or_none()


async def close_day(
    db: AsyncSession,
    record: DailySales,
    *,
    counted: Decimal,
    user_id: uuid.UUID | None,
    reason: str | None = None,
    auto: bool = False,
) -> None:
    """Settle a day's drawer, recording the change first."""
    await record_change(
        db,
        record.hotel_id,
        record.date,
        "cash_counted",
        record.cash_counted,
        counted,
        user_id=user_id,
        reason=reason or ("closed automatically after midnight" if auto else None),
        source="auto" if auto else "user",
    )
    record.cash_counted = counted
    record.closed_at = datetime.now(UTC)
    record.auto_closed = auto
