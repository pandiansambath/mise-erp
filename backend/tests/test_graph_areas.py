"""A timer is not a feature.

Measured across the whole fleet by a design pass: every restaurant's two
busiest "areas" were `talent` and `notifications`, EXACTLY PAIRED —

    NIRAI 657/643 · ckb 210/210 · pkpk 118/118 · opk 44/44 · pppk 8/8

Exact pairs are not what people do. That is `NotificationBell` calling
`/api/notifications` and `/api/talent/chats` on a 45-second `setInterval`,
in every open tab, whether anybody is looking or not.

So thirteen restaurants wore an identical crown, and the one question this
part of the operator map exists to answer — what do they actually use? — was
being answered with a fingerprint of our own polling.

These are pure-function assertions on the classification, so they need no
database.
"""
from app.platform_admin.graph import POLLED_AREAS


def test_the_bells_own_endpoints_are_not_features():
    """The two that produced the identical crown."""
    assert "notifications" in POLLED_AREAS
    assert "talent" in POLLED_AREAS


def test_real_areas_are_not_swept_up_with_them():
    """The exclusion must stay narrow. Excluding anything a person opens
    would trade one wrong answer for another."""
    for area in (
        "inventory", "vendors", "recipes", "employees", "sales",
        "expenses", "purchasing", "payroll", "rota", "attendance",
        "orders", "reports", "money", "assistant",
    ):
        assert area not in POLLED_AREAS, area


def test_the_set_is_small_and_deliberate():
    """A growing exclusion list is how a usage metric quietly becomes a
    curated one. If this needs to grow, it needs an argument per entry."""
    assert len(POLLED_AREAS) <= 4
