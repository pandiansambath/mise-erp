"""Payroll calculation — pure, exact functions (heavily tested).

Wrong payroll = paying staff wrong, so this is kept free of I/O and unit-tested.

THE ROUNDING LAW. Hours are whole minutes, money is whole pence, and a payslip's
pay is the SUM of its day lines: what is shown for Monday to Sunday adds up to
what is paid, to the penny, always. In between, sums are done on fractions, so
nothing is ever rounded twice.
"""
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

MIN_WAGE_UK = Decimal("11.44")  # £/hour (2024); update annually
_Q2 = Decimal("0.01")
OVERTIME_MULTIPLIER = Decimal("1.5")
STANDARD_DAY_MINUTES = 480


class MinWageError(ValueError):
    """Hourly rate below the UK statutory minimum."""


# ── day by day ───────────────────────────────────────────────────────────────
def pence(x: Fraction) -> int:
    """Pounds, exactly, to whole pence. Half a penny goes up. Never negative."""
    n = x * 100 + Fraction(1, 2)
    return n.numerator // n.denominator


def pounds(p: int) -> Decimal:
    return (Decimal(p) / 100).quantize(_Q2)


def to_minutes(hours: Decimal | None) -> int:
    """Hours as they are stored (two places) back to the minutes they came from.

    0.01 h is 0.6 of a minute, so the nearest whole minute is always the one:
    7h 20m is kept as 7.33 and comes back as 440, not 439.8.
    """
    if hours is None:
        return 0
    return int((Decimal(hours) * 60).to_integral_value(ROUND_HALF_UP))


def hourly_day(minutes: int, rate: Decimal) -> Decimal:
    """One day of an hourly person: minutes at a rate, to the penny."""
    return pounds(pence(Fraction(max(minutes, 0)) * Fraction(rate) / 60))


def spread(exact: list[Fraction]) -> list[Decimal]:
    """Whole-penny lines whose total is the exact total, rounded once.

    £3,000 over 26 days is 115.3846… a day. Rounding each day and adding up
    comes to £2,999.88 and somebody is 12p short every month. Here each line is
    the running total rounded, less the running total before it, so the lines
    are pennies apart and the sum is £3,000.00.
    """
    out: list[Decimal] = []
    running, before = Fraction(0), 0
    for x in exact:
        running += max(x, Fraction(0))
        now = pence(running)
        out.append(pounds(now - before))
        before = now
    return out


def apply_deductions(
    gross: Decimal, advance: Decimal, other_deductions: Decimal
) -> dict:
    """Take what can actually be taken, and remember the rest.

    A PAYSLIP CANNOT BE NEGATIVE. There was one in live data:

        pandian sambath   gross 0.00   deductions 3500.00   net -3500.00   PAID

    Somebody with an outstanding £3,500 advance and no days worked in the
    period. `net = gross - advance - other` had no floor, so the run produced a
    payslip that says the EMPLOYEE OWES £3,500, marked it PAID, and booked a
    NEGATIVE £3,500 expense into July's Staff Salaries — which silently reduced
    the month's costs by three and a half thousand pounds and made the P&L
    wrong, not just the payslip.

    Arithmetic is not the fix on its own. `max(net, 0)` would floor the payslip
    and quietly FORGIVE THE DEBT: the advance row gets marked recovered, the
    £3,500 is never taken, and the restaurant loses it with no record. Money
    does not disappear because a number was clipped. So this returns what was
    actually recovered AND what is still owed, and the caller is obliged to
    carry the remainder to the next run.

    ORDER MATTERS, and it is deliberate. `other_deductions` — penalties,
    statutory items — come off first; the advance is recovered from whatever
    survives. An advance is OUR money coming back and it can wait a period. A
    penalty is a charge for this period and belongs in this period.
    """
    gross = max(gross, Decimal("0"))
    other_applied = min(max(other_deductions, Decimal("0")), gross)
    advance_applied = min(max(advance, Decimal("0")), gross - other_applied)
    return {
        "other_applied": other_applied,
        "advance_applied": advance_applied,
        #: What is STILL OWED after this payslip. The caller must not mark an
        #: advance fully recovered while this is non-zero.
        "advance_outstanding": max(advance, Decimal("0")) - advance_applied,
        "other_outstanding": max(other_deductions, Decimal("0")) - other_applied,
        "net": gross - other_applied - advance_applied,
    }
