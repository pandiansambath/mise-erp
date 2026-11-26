"""A payslip cannot be negative, and a debt cannot vanish because of it.

These lock down a bug found in LIVE DATA on 2026-09-16:

    pandian sambath   gross 0.00   deductions 3500.00   net -3500.00   PAID

`net = gross - advance - other_deductions` had no floor, so an employee with an
outstanding £3,500 advance and no days worked got a payslip saying they owed the
restaurant £3,500 — marked PAID, and booked as a NEGATIVE £3,500 expense into
July's Staff Salaries, which made the month's labour cost (and the P&L) wrong by
three and a half thousand pounds.

The half of this that is easy to get wrong is the fix. Flooring the net at zero
stops the negative payslip and silently FORGIVES the debt: the advance is marked
recovered, the money never comes back, and nothing records that it happened. So
every test here checks BOTH halves — what came out of the payslip, and what is
still owed afterwards.

The pure calculator needs no database, which is why these run everywhere.
"""

from decimal import Decimal as D

import pytest

from app.payroll import calculator as c


def test_the_live_bug_no_pay_full_advance() -> None:
    """The exact production row. Nothing worked, £3,500 owed."""
    r = c.apply_deductions(D("0"), D("3500"), D("0"))
    assert r["net"] == D("0"), "a payslip must never be negative"
    assert r["advance_applied"] == D("0"), "nothing was available to take"
    # The whole point: the debt survives the payslip.
    assert r["advance_outstanding"] == D("3500")


def test_partial_recovery_takes_what_it_can_and_carries_the_rest() -> None:
    r = c.apply_deductions(D("400"), D("3500"), D("0"))
    assert r["advance_applied"] == D("400")
    assert r["net"] == D("0")
    assert r["advance_outstanding"] == D("3100")
    # It must reconcile: what was taken plus what is left is what was owed.
    assert r["advance_applied"] + r["advance_outstanding"] == D("3500")


def test_ordinary_pay_is_untouched() -> None:
    """The floor must not change a normal payslip. Most runs are this one."""
    r = c.apply_deductions(D("2600"), D("100"), D("0"))
    assert r["advance_applied"] == D("100")
    assert r["net"] == D("2500")
    assert r["advance_outstanding"] == D("0")


def test_penalties_come_off_before_the_advance() -> None:
    """Order is deliberate, and it is not arbitrary.

    A penalty is a charge for THIS period and belongs in it. An advance is our
    own money coming back and can wait a period. So when the pay cannot cover
    both, the penalty is taken and the advance waits.
    """
    r = c.apply_deductions(D("120"), D("500"), D("50"))
    assert r["other_applied"] == D("50")
    assert r["advance_applied"] == D("70")
    assert r["net"] == D("0")
    assert r["advance_outstanding"] == D("430")


def test_a_penalty_larger_than_the_pay_is_also_capped_and_carried() -> None:
    r = c.apply_deductions(D("12"), D("0"), D("500"))
    assert r["other_applied"] == D("12")
    assert r["net"] == D("0")
    assert r["other_outstanding"] == D("488")


@pytest.mark.parametrize(
    ("gross", "advance", "other"),
    [
        (D("0"), D("0"), D("0")),
        (D("100"), D("0"), D("0")),
        (D("100"), D("1000"), D("1000")),
        (D("0"), D("5000"), D("0")),
        (D("2600"), D("2600"), D("0")),
        # Negative inputs are not supposed to happen, and must not produce a
        # negative payslip if they do.
        (D("100"), D("-50"), D("-10")),
    ],
)
def test_net_is_never_negative_and_nothing_is_lost(
    gross: D, advance: D, other: D
) -> None:
    """The two invariants, over the whole space.

    1. A payslip is never negative.
    2. Nothing is forgiven: taken + still-owed equals what was owed.
    """
    d = c.apply_deductions(gross, advance, other)
    assert d["net"] >= 0
    assert d["advance_applied"] + d["advance_outstanding"] == max(advance, D("0"))
    assert d["other_applied"] + d["other_outstanding"] == max(other, D("0"))
    # And the payslip adds up.
    assert d["net"] == max(gross, D("0")) - d["other_applied"] - d["advance_applied"]
