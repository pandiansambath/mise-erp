"""The till has to balance.

The owner's whole reason for the project: *no money should get lost*. These are
not tests of an API shape — each one is a way real cash could go missing without
anything raising an error.

The worked example he gave, which `test_the_greens_example` follows exactly:
opening 300, sales 200, a staff member takes 50 for greens, spends 10, returns
40. At every step the expected figure must match what is physically in the box.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.sales import cash
from app.sales.models import PettyCash

TODAY = date(2026, 8, 4)
D = Decimal


def _petty(taken, spent=None, returned=None, status="OPEN"):
    return PettyCash(
        hotel_id=None, date=TODAY, taken_amount=D(taken),
        spent_amount=None if spent is None else D(spent),
        returned_amount=None if returned is None else D(returned),
        status=status,
    )


# ── the arithmetic, in isolation ─────────────────────────────────────────────

def test_money_still_out_is_missing_from_the_drawer() -> None:
    """Someone is out buying greens. Until they return the till IS short, and
    saying otherwise means the count never matches."""
    out = cash.summarise_petty([_petty(50)])
    assert out["still_out"] == D(50)
    assert out["returned"] == D(0)


def test_a_settled_float_stops_counting_as_missing() -> None:
    out = cash.summarise_petty([_petty(50, spent=10, returned=40, status="SETTLED")])
    assert out["still_out"] == D(0)
    assert out["spent"] == D(10)
    assert out["returned"] == D(40)
    assert out["unreconciled"] == [], "50 = 10 + 40 balances exactly"


def test_a_float_that_does_not_add_up_is_surfaced() -> None:
    """Took 50, spent 10, returned 30 — ten pounds nobody can explain. This is
    the single most important thing to show rather than absorb."""
    out = cash.summarise_petty([_petty(50, spent=10, returned=30, status="SETTLED")])
    assert len(out["unreconciled"]) == 1
    assert out["unreconciled"][0]["difference"] == D(10)


# ── the full drawer, against the database ────────────────────────────────────

@pytest.mark.asyncio
async def test_the_greens_example(db, hotel) -> None:
    """His exact scenario, start to finish."""
    # Opening 300, cash sales 200 -> the box should hold 500.
    drawer = await cash.drawer_for(
        db, hotel.id, TODAY, opening=D(300), cash_sales=D(200), counted=None
    )
    assert drawer["expected"] == D(500)

    # A staff member takes 50 for greens. The box is now 450.
    float_row = PettyCash(hotel_id=hotel.id, date=TODAY, taken_amount=D(50), purpose="greens")
    db.add(float_row)
    await db.commit()

    drawer = await cash.drawer_for(
        db, hotel.id, TODAY, opening=D(300), cash_sales=D(200), counted=None
    )
    assert drawer["expected"] == D(450), "money in someone's hand is not in the till"
    assert drawer["petty_out"] == D(50)

    # They return: 10 spent, 40 back in the box -> 490.
    float_row.spent_amount = D(10)
    float_row.returned_amount = D(40)
    float_row.status = "SETTLED"
    await db.commit()

    drawer = await cash.drawer_for(
        db, hotel.id, TODAY, opening=D(300), cash_sales=D(200), counted=None
    )
    assert drawer["expected"] == D(490), "500 - 10 actually spent"
    assert drawer["petty_out"] == D(0)


@pytest.mark.asyncio
async def test_only_cash_expenses_touch_the_till(db, hotel) -> None:
    """A bank-paid invoice changes the business's money but not the box on the
    counter. Mixing the two is the commonest reason a till 'does not balance'."""
    from app.expenses.models import Expense, ExpenseCategory

    cat = ExpenseCategory(hotel_id=hotel.id, name="Supplies", kind="VARIABLE")
    db.add(cat)
    await db.flush()
    db.add(Expense(hotel_id=hotel.id, category_id=cat.id, date=TODAY,
                   amount=D(30), payment_method="CASH"))
    db.add(Expense(hotel_id=hotel.id, category_id=cat.id, date=TODAY,
                   amount=D(500), payment_method="BANK"))
    await db.commit()

    drawer = await cash.drawer_for(
        db, hotel.id, TODAY, opening=D(100), cash_sales=D(0), counted=None
    )
    assert drawer["cash_expenses"] == D(30)
    assert drawer["expected"] == D(70), "the 500 bank payment must not move the drawer"


@pytest.mark.asyncio
async def test_a_settled_float_is_not_charged_twice(db, hotel) -> None:
    """Settling books an expense. If the drawer counted BOTH that expense and
    the float, the till would look short by the spend twice over."""
    from app.expenses.models import Expense, ExpenseCategory

    cat = ExpenseCategory(hotel_id=hotel.id, name="Produce", kind="VARIABLE")
    db.add(cat)
    await db.flush()
    expense = Expense(hotel_id=hotel.id, category_id=cat.id, date=TODAY,
                      amount=D(10), payment_method="CASH")
    db.add(expense)
    await db.flush()
    db.add(PettyCash(hotel_id=hotel.id, date=TODAY, taken_amount=D(50), spent_amount=D(10),
                     returned_amount=D(40), status="SETTLED", expense_id=expense.id))
    await db.commit()

    drawer = await cash.drawer_for(
        db, hotel.id, TODAY, opening=D(300), cash_sales=D(200), counted=None
    )
    # 500 - 10 (the expense) and NOT another 10 for the float.
    assert drawer["expected"] == D(490)


@pytest.mark.asyncio
async def test_variance_is_reported_against_the_full_picture(db, hotel) -> None:
    """The bug this replaced: expected used to be opening + cash sales only, so
    an honestly-run day with a cash expense always looked short."""
    from app.expenses.models import Expense, ExpenseCategory

    cat = ExpenseCategory(hotel_id=hotel.id, name="Gas", kind="FIXED")
    db.add(cat)
    await db.flush()
    db.add(Expense(hotel_id=hotel.id, category_id=cat.id, date=TODAY,
                   amount=D(40), payment_method="CASH"))
    await db.commit()

    drawer = await cash.drawer_for(
        db, hotel.id, TODAY, opening=D(200), cash_sales=D(100), counted=D(260)
    )
    assert drawer["expected"] == D(260)
    assert drawer["variance"] == D(0), "a correct day must read as balanced"


# ── carry-forward ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_yesterdays_close_becomes_todays_opening(db, hotel) -> None:
    """The float does not vanish overnight. Retyping it invites a typo into the
    one number the whole day is measured from."""
    from app.sales.models import DailySales

    db.add(DailySales(hotel_id=hotel.id, date=TODAY - timedelta(days=1),
                      opening_cash=D(100), cash_counted=D(455)))
    await db.commit()

    assert await cash.carried_opening(db, hotel.id, TODAY) == D(455)


@pytest.mark.asyncio
async def test_an_uncounted_yesterday_suggests_nothing(db, hotel) -> None:
    """Guessing here would invent a float out of nothing, and a wrong opening
    makes every later figure on the day wrong."""
    from app.sales.models import DailySales

    db.add(DailySales(hotel_id=hotel.id, date=TODAY - timedelta(days=1),
                      opening_cash=D(100), cash_counted=None))
    await db.commit()

    assert await cash.carried_opening(db, hotel.id, TODAY) is None


# ── the audit trail ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_every_change_to_a_cash_figure_is_recorded(db, hotel) -> None:
    """Cash is the one thing nobody can reconstruct from elsewhere. If a closing
    figure is edited three days later, this is the only way to know."""
    await cash.record_change(db, hotel.id, TODAY, "cash_counted", D(500), D(455),
                             reason="recount")
    await db.commit()

    events = await cash.history_for(db, hotel.id, TODAY)
    assert len(events) == 1
    assert events[0].old_value == D(500)
    assert events[0].new_value == D(455)
    assert events[0].reason == "recount"


@pytest.mark.asyncio
async def test_a_no_op_change_is_not_recorded(db, hotel) -> None:
    """A history full of '500 -> 500' hides the one line that matters."""
    await cash.record_change(db, hotel.id, TODAY, "cash_counted", D(500), D(500))
    await db.commit()
    assert await cash.history_for(db, hotel.id, TODAY) == []


@pytest.mark.asyncio
async def test_history_is_newest_first(db, hotel) -> None:
    """Checking a suspicious figure means wanting the LAST change, not the first."""
    await cash.record_change(db, hotel.id, TODAY, "cash_counted", D(0), D(100))
    await db.commit()
    await cash.record_change(db, hotel.id, TODAY, "cash_counted", D(100), D(200))
    await db.commit()

    events = await cash.history_for(db, hotel.id, TODAY)
    assert [e.new_value for e in events] == [D(200), D(100)]
