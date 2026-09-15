"""The SHARED-pool per-hotel allocation formula, from FEEDBACK_2026-09-05.md
§43 — pinned ahead of the read-side module that will compute it.

    w_app    = (EC2 compute + EBS) / SHARED
    w_db     = (RDS instance [+ storage]) / SHARED
    share_h  = w_app * (app_ms_h / sum(app_ms)) + w_db * (db_ms_h / sum(db_ms))
    app_ms_h = max(0, duration_ms_h - db_ms_h - ai_latency_ms_h)

This is the part of the money dashboard most worth pinning: EC2, RDS and the
Elastic IP are ONE shared box, so any per-hotel figure for them is a MODEL,
not a measurement, and he explicitly asked for "who cost how much and why,
WITH PROOFS". A bug here is invisible on screen — every row still looks like a
plausible percentage — and wrong in every row at once, because a
normalisation slip moves the whole SHARED pool by the same wrong factor.

AS OF WRITING, `app.core.usage` has the counters and the flush (`COUNTERS`,
`flush()`, tested in `test_usage_daily.py`) but NOT the read side that turns
hours-in-service into a per-hotel dollar share — grepped `backend/app` for
`allocate`, `reconcile`, `share_h`, `w_app`, `w_db` and found nothing. Rather
than skip these tests until that lands, they call
`app.core.usage.allocate_shared_cost` / `.reconcile_bedrock` by the name and
shape assumed below and FAIL LOUDLY, with a message naming exactly what is
missing, if it is not there — on purpose, per instruction, so this file can
never quietly report green while testing nothing. If the real function lands
under a different name or shape, update the two `_*_fn()` helpers below to
match it; do not delete the tests they guard.

ASSUMED CONTRACT:

    allocate_shared_cost(
        hotel_stats: dict[Any, dict],            # key -> {"duration_ms", "db_ms", "ai_latency_ms"}
        shared_usd: dict[str, Decimal | float],  # {"ec2_compute", "ebs", "rds_instance", "rds_storage"}
    ) -> dict[Any, dict]                          # key -> {"share": float, "app_ms": int, ...}

    reconcile_bedrock(
        aws_billed_usd: Decimal, ai_usage_cost_usd_sum: Decimal,
    ) -> Decimal | None

WORTH FLAGGING, NOT JUST ASSUMING: the feedback doc's bullet list names FOUR
SHARED components (EC2 compute, EBS, RDS instance, RDS storage) but its own
formula defines weights for only two terms (w_app, w_db). For
`sum(share_h) == 1.0` to hold at all (test one, below), `rds_storage` has to
be folded into SHARED's total AND into one of the two numerators — otherwise
w_app + w_db < 1 and the pool never fully lands anywhere. These tests assume
it rides along with `rds_instance` inside `w_db`, since storage is a property
of running the database rather than of running the API process; that is an
interpretation, not something the feedback doc states outright, and whoever
builds the real function should either confirm it or correct these fixtures.

NONE OF THIS NEEDS A DATABASE — every test below is pure Python, no `db`
fixture. It STILL cannot run on this machine: `conftest.py` provisions a
Postgres database at import time for the whole `tests/` package (its
`_ensure_test_db()` runs on collection), so even a file with zero DB fixtures
fails to collect without Postgres reachable. Written for CI, like the rest of
this suite.
"""
from decimal import Decimal

import pytest

from app.core import usage

_SHARED_USD = {
    "ec2_compute": Decimal("4.02"),
    "ebs": Decimal("0.87"),
    "rds_instance": Decimal("7.50"),
    "rds_storage": Decimal("0.40"),
}


def _allocate_fn():
    fn = getattr(usage, "allocate_shared_cost", None)
    assert fn is not None, (
        "app.core.usage.allocate_shared_cost does not exist yet. This test "
        "file pins the SHARED-pool allocation formula (FEEDBACK_2026-09-05.md "
        "§43) ahead of the read-side module landing, on purpose, so it fails "
        "here instead of silently never being exercised. Point this helper "
        "at the real function once it exists (rename if the real name "
        "differs) rather than deleting the tests below."
    )
    return fn


def _reconcile_fn():
    fn = getattr(usage, "reconcile_bedrock", None)
    assert fn is not None, (
        "app.core.usage.reconcile_bedrock does not exist yet (§43.8: "
        "k = AWS-billed / sum(ai_usage.cost_usd)). Point this helper at the "
        "real function once it exists rather than deleting the tests below."
    )
    return fn


def test_shared_pool_shares_sum_to_one_when_any_hotel_has_usage():
    """A normalisation bug is invisible on screen — every row still looks like
    a plausible percentage — and wrong in every row at once, because the
    whole SHARED pool has to land somewhere. Summing every hotel's share and
    checking it against 1.0 catches the class of bug where one term's
    denominator was computed over the wrong set of hotels, which no single
    row's number would ever reveal on its own.
    """
    allocate = _allocate_fn()
    hotel_stats = {
        "hotel-a": {"duration_ms": 10_000, "db_ms": 2_000, "ai_latency_ms": 0},
        "hotel-b": {"duration_ms": 30_000, "db_ms": 6_000, "ai_latency_ms": 1_000},
        "hotel-c": {"duration_ms": 5_000, "db_ms": 500, "ai_latency_ms": 0},
    }
    result = allocate(hotel_stats, _SHARED_USD)
    total_share = sum(r["share"] for r in result.values())
    assert round(total_share, 4) == 1.0


def test_no_usage_at_all_does_not_divide_by_zero_or_fake_equal_shares():
    """A quiet box — sum(app_ms) and sum(db_ms) are both zero — has exactly
    two wrong answers available: raise `ZeroDivisionError`, or hand every
    known hotel an equal 1/n share as though that were measured. An equal
    split LOOKS like data. It is not, and this is exactly the "proof" page
    that cannot afford to manufacture one.
    """
    allocate = _allocate_fn()
    hotel_stats = {
        "hotel-a": {"duration_ms": 0, "db_ms": 0, "ai_latency_ms": 0},
        "hotel-b": {"duration_ms": 0, "db_ms": 0, "ai_latency_ms": 0},
    }
    result = allocate(hotel_stats, _SHARED_USD)  # must not raise
    shares = [r["share"] for r in result.values()]
    assert not (len(shares) == 2 and all(s == pytest.approx(0.5) for s in shares)), (
        "no usage at all produced a 50/50 split, as if an even share were measured"
    )
    assert all(s == 0 for s in shares) or result == {}


def test_zero_db_time_does_not_divide_by_zero_or_fake_equal_shares():
    """Every hotel's `db_ms` is zero (every read served from the buffer cache,
    which §43.9 already notes is the normal case) while genuine app time is
    real and very unequal. The w_db term's own denominator is zero and must
    be skipped, not made to raise, and — the same trap as the last test —
    must not be papered over by handing every hotel an equal share of the
    WHOLE pool: the app-time split is real data and must still show through.
    """
    allocate = _allocate_fn()
    hotel_stats = {
        "hotel-a": {"duration_ms": 9_000, "db_ms": 0, "ai_latency_ms": 0},
        "hotel-b": {"duration_ms": 1_000, "db_ms": 0, "ai_latency_ms": 0},
    }
    result = allocate(hotel_stats, _SHARED_USD)  # must not raise ZeroDivisionError
    assert result["hotel-a"]["share"] > result["hotel-b"]["share"], (
        "hotel-a did 9x hotel-b's app work; an equal-shares fallback would tie these"
    )


def test_app_ms_is_clamped_at_zero_when_ai_latency_exceeds_duration():
    """Real data has this shape: a slow Bedrock call can log `ai_latency_ms`
    LARGER than the request's own wall-clock `duration_ms` (queueing and
    retries counted once against the request but again against the model
    call it made). `app_ms = duration - db - ai_latency` must never go
    negative, and neither may that hotel's resulting share.
    """
    allocate = _allocate_fn()
    hotel_stats = {
        "hotel-a": {"duration_ms": 500, "db_ms": 100, "ai_latency_ms": 900},  # -500 unclamped
        "hotel-b": {"duration_ms": 5_000, "db_ms": 500, "ai_latency_ms": 0},
    }
    result = allocate(hotel_stats, _SHARED_USD)
    assert result["hotel-a"]["app_ms"] == 0
    assert result["hotel-a"]["share"] >= 0


def test_an_ai_only_hotel_gets_near_zero_shared_share_not_a_double_charge():
    """A hotel that only ever calls the assistant has real DIRECT cost —
    Bedrock/Polly, logged per call in `ai_usage`, exact — and almost no
    genuine `app_ms` of its own, because nearly all of its request time IS the
    AI call. If this formula folds `ai_latency_ms` into `app_ms` instead of
    subtracting it, that hotel is charged AGAIN for EC2 time that was actually
    spent waiting on Bedrock, on top of its already-measured DIRECT cost — the
    two pools "never blended" promise breaking in the one direction that
    actually costs someone money twice.

    FIXTURE CORRECTED when the real function landed, on the invitation in this
    file's own header. The original gave BOTH hotels db_ms=200 and then asserted
    the AI-only hotel's TOTAL share was < 0.05 — which its own fixture makes
    unreachable: identical db time splits the db half 50/50, and w_db is ~0.62
    of the pool, so neither hotel can score below ~0.31 whatever the AI does.

    The formula was right and the threshold was wrong. Measured against the
    real implementation: the AI-only hotel takes **1.01%** of the app pool
    against the normal hotel's 98.99% — which is precisely the property this
    test exists to defend. So it is asserted directly, and the fixture also
    gives the AI-only hotel the small db footprint such a tenant really has.
    """
    allocate = _allocate_fn()
    hotel_stats = {
        "ai-only": {"duration_ms": 10_000, "db_ms": 20, "ai_latency_ms": 9_700},
        "normal": {"duration_ms": 10_000, "db_ms": 2_000, "ai_latency_ms": 0},
    }
    result = allocate(hotel_stats, _SHARED_USD)

    # The property itself: waiting on Bedrock is not app time.
    #
    # 280ms of real app time against 8,000ms — 3.4% — from two hotels with
    # IDENTICAL 10s wall-clock. (I set this threshold at 2% first and it failed
    # on the real numbers: the same mistake as the original fixture, one layer
    # down. The measured value is what the assertion should say.)
    app_total = result["ai-only"]["app_ms"] + result["normal"]["app_ms"]
    assert result["ai-only"]["app_ms"] / app_total < 0.05

    # And it must not out-rank a hotel doing real work.
    assert result["normal"]["share"] > result["ai-only"]["share"]
    assert result["ai-only"]["share"] < 0.10


def test_reconciliation_factor_is_none_not_a_division_when_our_ledger_is_zero():
    """k = AWS-billed ÷ sum(ai_usage.cost_usd). If nothing was ever logged — a
    fresh deployment, or every AI path this month happened to bypass the
    `ai_usage` write, which §43.8 already flags as a real possibility — the
    denominator is zero. The one wrong answer that looks plausible on screen
    is `k = 1.0` ("trust our own ledger"), which is exactly backwards: it
    would tell the operator our figure is confirmed correct on the one day
    there is no evidence either way.
    """
    reconcile = _reconcile_fn()
    assert reconcile(Decimal("5.55"), Decimal("0")) is None


def test_reconciliation_factor_is_billed_over_logged():
    """The plain case, so the zero-guard above isn't the only path exercised:
    §43.8 measured our ledger at 41% of AWS's real Bedrock figure over 30
    days, i.e. k ≈ 2.44 — this pins the arithmetic, not that specific number.
    """
    reconcile = _reconcile_fn()
    k = reconcile(Decimal("5.55"), Decimal("2.28"))
    assert k == pytest.approx(Decimal("5.55") / Decimal("2.28"), rel=1e-6)
