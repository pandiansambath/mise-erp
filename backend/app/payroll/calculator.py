"""Payroll calculation — pure, exact-Decimal functions (heavily tested).

Wrong payroll = paying staff wrong, so this is kept free of I/O and unit-tested.
"""
from decimal import ROUND_HALF_UP, Decimal

MIN_WAGE_UK = Decimal("11.44")  # £/hour (2024); update annually
_Q2 = Decimal("0.01")
OVERTIME_MULTIPLIER = Decimal("1.5")
STANDARD_DAY_HOURS = Decimal("8")


class MinWageError(ValueError):
    """Hourly rate below the UK statutory minimum."""


def _q(x: Decimal) -> Decimal:
    return x.quantize(_Q2, ROUND_HALF_UP)


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


def calc_monthly(
    *,
    monthly_salary: Decimal,
    working_days: int,
    days_present: int,
    half_days: int = 0,
    overtime_hours: Decimal = Decimal("0"),
    advance: Decimal = Decimal("0"),
    other_deductions: Decimal = Decimal("0"),
) -> dict:
    wd = Decimal(working_days if working_days > 0 else 1)
    daily = monthly_salary / wd
    base = Decimal(days_present) * daily + Decimal(half_days) * (daily / 2)
    overtime_pay = overtime_hours * (daily / STANDARD_DAY_HOURS) * OVERTIME_MULTIPLIER
    gross = base + overtime_pay
    d = apply_deductions(gross, advance, other_deductions)
    return {
        "gross_pay": _q(gross),
        "overtime_pay": _q(overtime_pay),
        # What was actually TAKEN, not what was owed. These two differ exactly
        # when the pay did not cover the debt, and the payslip must show the
        # amount that left this payslip.
        "advance_deduction": _q(d["advance_applied"]),
        "other_deductions": _q(d["other_applied"]),
        "net_pay": _q(d["net"]),
        # Still owed. The caller carries these forward; a payslip that clips the
        # net without carrying the remainder forgives the debt.
        "advance_outstanding": _q(d["advance_outstanding"]),
        "other_outstanding": _q(d["other_outstanding"]),
    }


def calc_hourly(
    *,
    hourly_rate: Decimal,
    total_hours: Decimal,
    advance: Decimal = Decimal("0"),
    other_deductions: Decimal = Decimal("0"),
    min_wage: Decimal = MIN_WAGE_UK,
) -> dict:
    if hourly_rate < min_wage:
        raise MinWageError(
            f"Hourly rate £{hourly_rate} is below the minimum wage £{min_wage}"
        )
    gross = total_hours * hourly_rate
    d = apply_deductions(gross, advance, other_deductions)
    return {
        "gross_pay": _q(gross),
        "overtime_pay": Decimal("0.00"),
        "advance_deduction": _q(d["advance_applied"]),
        "other_deductions": _q(d["other_applied"]),
        "net_pay": _q(d["net"]),
        "advance_outstanding": _q(d["advance_outstanding"]),
        "other_outstanding": _q(d["other_outstanding"]),
    }
