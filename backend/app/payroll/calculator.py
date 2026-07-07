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
    net = gross - advance - other_deductions
    return {
        "gross_pay": _q(gross),
        "overtime_pay": _q(overtime_pay),
        "advance_deduction": _q(advance),
        "other_deductions": _q(other_deductions),
        "net_pay": _q(net),
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
    net = gross - advance - other_deductions
    return {
        "gross_pay": _q(gross),
        "overtime_pay": Decimal("0.00"),
        "advance_deduction": _q(advance),
        "other_deductions": _q(other_deductions),
        "net_pay": _q(net),
    }
