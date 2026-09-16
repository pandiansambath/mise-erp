"""The AWS bill collector — the brakes, and the record of what it spent.

`ce:GetCostAndUsage` is $0.01 A CALL and it is already a visible line on our own
bill ("AWS Cost Explorer . USE1-APIRequest"). A ten-second live refresh — which
is what "WE NEED A LIVE DASHBOARD" literally asks for — would cost $5,184 a
month to watch a $30 bill, and the dashboard would become the largest line on
the dashboard.

So `aws_bill` has three brakes, and this file is what stops any of them being
quietly removed by someone who reads the code and thinks a cent is nothing:

  1. a 6-hour COOLDOWN held in the DATABASE, not in a session — two tabs or
     three operators must not each get their own allowance;
  2. a hard CEILING of `MONTHLY_CALL_CEILING` calls per calendar month, counted
     from calls ACTUALLY MADE, including failed ones, because AWS bills a
     failed call exactly like a successful one. A retry loop against a
     permissions error spends real money and returns nothing;
  3. `force=True`, which the Refresh button uses, releases the cooldown and
     NEVER the ceiling.

And one thing that is not a brake but belongs here: every run writes a row to
`telemetry_sync`, pass or fail. Without it a quiet day and a dead collector look
identical on the chart — the billing equivalent of "page scrolls 0px", an
instrument that reads the same for success and for failure.

THESE TESTS NEED A REAL POSTGRES and do not run on the Windows box: `db` comes
from `tests/conftest.py`, which provisions `mise_test` at import. Written for CI.
Nothing here calls AWS.
"""

import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core import usage
from app.platform_admin import aws_bill
from app.platform_admin.aws_bill import (
    BACKFILL_MONTHS,
    COOLDOWN,
    JOB,
    MONTHLY_CALL_CEILING,
    fetch,
    month_start,
    spend_guard,
)
from app.platform_admin.models import CloudCostDaily, TelemetrySync

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def real_rows() -> list[dict]:
    """What a real fetch hands the upsert — built from the captured bill.

    Same trimmed capture `test_aws_bill.py` documents: the whole of July 2026
    plus two flagged September days, straight out of Cost Explorer.
    """
    charges = json.loads((FIXTURES / "ce_charges.json").read_text(encoding="utf-8"))
    credits = json.loads((FIXTURES / "ce_credits.json").read_text(encoding="utf-8"))
    return aws_bill._dedupe(
        aws_bill._rows_from(charges["ResultsByTime"], record_type="Usage")
        + aws_bill._rows_from(credits["ResultsByTime"], record_type=None)
    )


def stub_aws(monkeypatch, *, rows: list[dict] | None = None, calls: int = 2) -> list[tuple]:
    """Replace the two Cost Explorer calls; return the windows asked for."""
    asked: list[tuple] = []

    def _fake(start: date, end: date):
        asked.append((start, end))
        return list(rows or []), calls

    monkeypatch.setattr(aws_bill, "_fetch_blocking", _fake)
    return asked


async def sync_rows(db) -> list[TelemetrySync]:
    db.expire_all()  # the fetch committed on this session; do not read a cached instance
    return list(
        (await db.execute(select(TelemetrySync).order_by(TelemetrySync.started_at))).scalars().all()
    )


# -- what the ceiling counts -----------------------------------------------


async def test_a_failed_cost_explorer_call_still_counts_against_the_ceiling(db) -> None:
    """AWS bills a failed call. The ceiling has to know about it.

    Counting successes only is the obvious implementation and it is the one
    that lets a broken collector — expired credentials, a bad IAM policy, a
    throttle — retry all month against a ceiling that believes it never ran.
    The ceiling is only worth having because it is arithmetic on what we
    actually spent.
    """
    now = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
    db.add(TelemetrySync(job=JOB, ok=True, api_calls=2, finished_at=now - timedelta(days=2)))
    db.add(TelemetrySync(job=JOB, ok=False, api_calls=2, finished_at=now - timedelta(days=1),
                         error="AccessDeniedException: no ce:GetCostAndUsage"))
    await db.commit()

    guard = await spend_guard(db, now=now)

    assert guard["calls_this_month"] == 4, "the failed run's two calls were not counted"
    assert guard["spent_usd"] == pytest.approx(0.04)
    assert guard["ceiling"] == MONTHLY_CALL_CEILING
    assert guard["at_ceiling"] is False
    assert guard["cooling_down"] is False, "a run a day old is not a cooldown"


async def test_the_ceiling_counts_this_calendar_month_only(db) -> None:
    """It "resets on the 1st" — that sentence is in the refusal the operator
    reads, so it had better be true. A rolling 30-day window would keep last
    month's spend on the meter and refuse refreshes in a month that has not
    been paid for yet."""
    now = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
    db.add(TelemetrySync(job=JOB, ok=True, api_calls=140, finished_at=datetime(2026, 8, 31, 23, 0, tzinfo=UTC)))
    db.add(TelemetrySync(job=JOB, ok=True, api_calls=6, finished_at=datetime(2026, 9, 1, 0, 30, tzinfo=UTC)))
    await db.commit()

    guard = await spend_guard(db, now=now)

    assert guard["calls_this_month"] == 6, "last month's calls were carried into this month"
    assert guard["at_ceiling"] is False
    # ...but "when did we last ask AWS anything" is NOT month-scoped, because a
    # cooldown that resets at midnight on the 1st is not a cooldown.
    assert guard["last_run"] == datetime(2026, 9, 1, 0, 30, tzinfo=UTC)


async def test_the_other_collectors_calls_do_not_count_against_the_aws_ceiling(db) -> None:
    """`telemetry_sync` holds every collector — the five-minute usage flush
    writes here too, under `usage_flush`. If its rows counted, the AWS ceiling
    would be hit within hours by a job that costs nothing, and the money page
    would go stale with a refusal nobody could explain."""
    now = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
    db.add(TelemetrySync(job="usage_flush", ok=True, api_calls=500, finished_at=now - timedelta(minutes=5)))
    await db.commit()

    guard = await spend_guard(db, now=now)

    assert guard["calls_this_month"] == 0
    assert guard["at_ceiling"] is False
    assert guard["cooling_down"] is False, "another job's run started the AWS cooldown"
    assert guard["last_run"] is None


# -- the refusals ----------------------------------------------------------


async def test_at_the_ceiling_the_refresh_button_refuses_and_spends_nothing(db, monkeypatch) -> None:
    """The worst case this key can reach is $1.50 a month, and that has to be
    arithmetic rather than a promise. At the ceiling nothing is called at all —
    not one more cent — and the operator is told why, in words, at HTTP 200."""
    db.add(TelemetrySync(job=JOB, ok=True, api_calls=MONTHLY_CALL_CEILING,
                         finished_at=datetime.now(UTC) - timedelta(days=1)))
    await db.commit()
    asked = stub_aws(monkeypatch)

    result = await fetch(db, reason="manual:control@mise.app")

    assert result["ok"] is False and result["skipped"] is True
    assert result["at_ceiling"] is True
    assert "ceiling" in result["reason"].lower()
    assert "resets on the 1st" in result["reason"]
    assert asked == [], "a refusal still called Cost Explorer"
    assert len(await sync_rows(db)) == 1, "a refusal wrote a telemetry row, inflating the count it refused on"


async def test_force_releases_the_cooldown_but_never_the_ceiling(db, monkeypatch) -> None:
    """The Refresh button sends `force`. It must not be a way round the money.

    The cooldown is a politeness — "you asked 20 minutes ago". The ceiling is
    the spend limit. One is overridable by a person who knows why they are
    asking; the other is not overridable by anyone, which is what makes $1.50 a
    fact rather than an intention.
    """
    db.add(TelemetrySync(job=JOB, ok=True, api_calls=MONTHLY_CALL_CEILING + 10,
                         finished_at=datetime.now(UTC) - timedelta(days=3)))
    await db.commit()
    asked = stub_aws(monkeypatch)

    result = await fetch(db, force=True, reason="manual:control@mise.app")

    assert result["ok"] is False and result["skipped"] is True
    assert "ceiling" in result["reason"].lower()
    assert asked == [], "force spent money past the ceiling"


async def test_a_second_tab_inside_the_cooldown_does_not_double_the_bill(db, monkeypatch) -> None:
    """The cooldown lives in the DATABASE for exactly this reason.

    Per-session and two tabs defeat it; per-operator and three operators triple
    the bill. And the refusal says WHY — a Refresh button that goes quiet is a
    button people press four more times.
    """
    db.add(TelemetrySync(job=JOB, ok=True, api_calls=2, finished_at=datetime.now(UTC)))
    await db.commit()
    asked = stub_aws(monkeypatch)

    result = await fetch(db, reason="manual:second-tab")

    assert result["ok"] is False and result["skipped"] is True
    assert result["cooling_down"] is True
    assert "less than 6 hours ago" in result["reason"]
    assert result["next_allowed"] is not None and result["next_allowed"] - result["last_run"] == COOLDOWN
    assert asked == [], "the cooldown was announced and then ignored"

    # The same operator, now saying they mean it: force releases this one.
    forced = await fetch(db, force=True, reason="manual:i-mean-it")

    assert forced["ok"] is True and forced["skipped"] is False
    assert asked, "force did not release the cooldown"


# -- the window it asks for ------------------------------------------------


async def test_the_first_ever_run_reaches_back_two_whole_months(db, monkeypatch) -> None:
    """    "i thoguht previous month datas will show here..but nting ihsowing"

    Cost Explorer keeps ~14 months and charges per CALL, not per day returned,
    so a backfill costs exactly what fetching today costs. A collector that
    started at today and walked forward would leave "previous month" blank for
    a month — the complaint this whole module exists to answer.
    """
    asked = stub_aws(monkeypatch, rows=[])
    today = datetime.now(UTC).date()

    result = await fetch(db, reason="scheduled")

    assert result["ok"] is True
    assert asked == [(month_start(today, BACKFILL_MONTHS), today)]
    assert asked[0][0].day == 1, "the backfill must start at a month boundary, not 'two months ago today'"


async def test_a_later_run_re_asks_the_ten_day_restatement_window(db, monkeypatch) -> None:
    """Re-asking for days already stored is the CORRECTION, not waste.

    Cost Explorer restates recent days as usage settles. Fetching only today
    would freeze yesterday's provisional figure forever. The window is safe to
    re-ask only because the write is an upsert that REPLACES — which is what
    `test_cloud_cost_daily.py` pins from the other side.
    """
    db.add(CloudCostDaily(
        day=date(2026, 9, 1), service="Amazon Relational Database Service",
        usage_type="EUW2-InstanceUsage:db.t4g.micro", record_type="Usage",
        amount_usd=Decimal("0.39"), quantity=Decimal("24"),
        as_of=datetime.now(UTC), is_estimate=False,
    ))
    await db.commit()
    asked = stub_aws(monkeypatch, rows=[])
    today = datetime.now(UTC).date()

    await fetch(db, reason="scheduled")

    assert asked == [(today - timedelta(days=10), today)]


# -- the record of the run -------------------------------------------------


async def test_a_successful_fetch_writes_the_bill_and_says_what_it_cost(db, monkeypatch) -> None:
    """The effect, end to end: rows in `cloud_cost_daily`, one telemetry row.

    Asserted on the DATA, not on the calls — "the July gross is $9.22 in the
    database" is the thing the page reads, and a green test that only proves
    `upsert_cloud_cost` was called would have survived every bug worth
    catching here. The credit rows are checked separately from the charges,
    because that is the distinction the whole module exists to preserve.
    """
    rows = real_rows()
    asked = stub_aws(monkeypatch, rows=rows, calls=2)

    result = await fetch(db, start=date(2026, 7, 1), end=date(2026, 9, 16), reason="manual:control@mise.app")

    assert asked == [(date(2026, 7, 1), date(2026, 9, 16))]
    assert result["ok"] is True and result["skipped"] is False
    assert result["rows_written"] == len(rows)
    assert result["api_calls"] == 2
    assert result["api_cost_usd"] == pytest.approx(0.02)

    db.expire_all()  # upsert_cloud_cost is Core SQL; the identity map has not heard about it

    stored = (await db.execute(select(func.count(CloudCostDaily.id)))).scalar()
    assert stored == len(rows)

    july_usage = (await db.execute(
        select(func.sum(CloudCostDaily.amount_usd)).where(
            CloudCostDaily.record_type == "Usage",
            CloudCostDaily.day >= date(2026, 7, 1),
            CloudCostDaily.day <= date(2026, 7, 31),
        )
    )).scalar()
    july_credit = (await db.execute(
        select(func.sum(CloudCostDaily.amount_usd)).where(
            CloudCostDaily.record_type == "Credit",
            CloudCostDaily.day >= date(2026, 7, 1),
            CloudCostDaily.day <= date(2026, 7, 31),
        )
    )).scalar()

    assert round(july_usage, 2) == Decimal("9.22"), f"July gross usage arrived as {july_usage}"
    assert round(july_credit, 2) == Decimal("-9.22"), f"July credit arrived as {july_credit}"
    assert round(july_usage + july_credit, 2) == Decimal("0.00"), "invoiced is $0.00 — and both halves are still there"

    runs = await sync_rows(db)
    assert len(runs) == 1
    run = runs[0]
    assert run.job == JOB and run.ok is True
    assert run.rows_written == len(rows)
    assert run.api_calls == 2
    assert run.api_cost_usd == Decimal("0.0200"), "the dashboard shows what it costs to run itself"
    assert run.covers_from == date(2026, 7, 1) and run.covers_to == date(2026, 9, 16)
    assert run.detail == {"reason": "manual:control@mise.app"}
    assert run.error is None
    assert run.finished_at is not None, "a run with no finished_at is invisible to the cooldown"


async def test_a_failed_fetch_is_still_written_down(db, monkeypatch) -> None:
    """A gap has to be visible, or a dead collector draws a flat line.

    The scheduler swallows this exception on purpose — Cost Explorer being down
    must never take down an app that serves restaurants their orders — so
    `telemetry_sync` is the ONLY place the failure is ever recorded, and the
    only reason the page can say "AWS figures have never been fetched" instead
    of quietly showing stale ones as current.
    """
    def _boom(start, end):
        raise RuntimeError("AccessDeniedException: user is not authorized to perform ce:GetCostAndUsage")

    monkeypatch.setattr(aws_bill, "_fetch_blocking", _boom)

    result = await fetch(db, reason="scheduled")

    assert result["ok"] is False
    assert result["skipped"] is False, "a failure is not a skip — the difference is whether we tried"
    assert "AccessDeniedException" in result["reason"]

    runs = await sync_rows(db)
    assert len(runs) == 1, "the failure left no trace at all"
    assert runs[0].ok is False
    assert runs[0].error.startswith("RuntimeError: AccessDeniedException")
    assert runs[0].covers_from is not None and runs[0].covers_to is not None, \
        "a failure row without its window cannot tell you which days are missing"
    assert runs[0].detail == {"reason": "scheduled"}
    assert len(runs[0].error) <= 500, "the error column is Text but the module truncates at 500"


@pytest.mark.xfail(
    strict=True,
    reason=(
        "REAL BUG, reported not patched: `fetch` learns the call count only from "
        "`_fetch_blocking`'s RETURN VALUE (`rows, calls = await asyncio.to_thread(...)`), "
        "so any failure after the first billed request records api_calls=0. The module's "
        "own comment promises the opposite — 'record the calls it burned ... leaving it "
        "uncounted would let a broken collector spend past a ceiling that believes it "
        "never ran'. Throttling on the second of the two calls is the everyday way in. "
        "Remove this marker when _fetch_blocking reports calls on the failure path too."
    ),
)
async def test_a_failure_after_the_first_call_still_counts_the_cent_it_spent(db, monkeypatch) -> None:
    """Charges fetched, then AWS throttles the credits call. One cent is gone.

    This is not a hypothetical: `ThrottlingException` on the second call of a
    pair is the most ordinary failure Cost Explorer has, and the paginated case
    is worse — every page already billed is forgotten. The ceiling is the only
    thing standing between a retry loop and a real bill, and it can only count
    what it is told.
    """
    class HalfBrokenCE:
        def __init__(self) -> None:
            self.calls = 0

        def get_cost_and_usage(self, **kw):
            self.calls += 1
            if self.calls == 1:
                return {"ResultsByTime": []}  # billed, $0.01 gone
            raise RuntimeError("ThrottlingException: Rate exceeded")

    client = HalfBrokenCE()
    monkeypatch.setattr(aws_bill, "_ce_client", lambda: client)

    result = await fetch(db, reason="scheduled")

    assert result["ok"] is False
    assert client.calls == 2, "the test did not exercise a partial failure"

    runs = await sync_rows(db)
    assert len(runs) == 1
    assert runs[0].api_calls == 1, "a billed call was not counted against the ceiling"
    assert runs[0].api_cost_usd == Decimal("0.0100")


# -- the first run, at the size the first run actually is ------------------


async def test_the_first_ever_backfill_writes_in_one_statement(db) -> None:
    """The run that matters most is the biggest one, and it happens once.

    `upsert_cloud_cost` sends every row in ONE multi-VALUES insert. asyncpg
    refuses a statement with more than 32,767 bind parameters, and each row
    here carries ten (id included — `id` has a Python-side uuid4 default, so it
    is a parameter, not a server default). That is a hard ceiling of about
    3,270 rows per fetch.

    A first run backfills `BACKFILL_MONTHS` whole months plus the current one.
    The live capture behind these fixtures is 2,836 rows for 2026-07-01..09-16
    — 87% of the limit, and only because the account was idle for the first 22
    days of July. At the current ~51 stored rows a day, a fully active 78-day
    window is about 4,000 rows and this write stops working.

    So this test runs the real write at the size a real first run is today. If
    it ever goes red with a parameter-count error, the fix is to chunk the
    upsert — NOT to shorten the backfill, because the backfill is the feature.
    """
    now = datetime.now(UTC)
    rows = [
        {
            "day": date(2026, 7, 1) + timedelta(days=i // 52),
            "service": f"Service {i % 52:02d} (Amazon Bedrock Edition)",
            "usage_type": f"EUW2-UsageType:{i % 7}",
            "record_type": "Usage",
            "amount_usd": Decimal("0.001234"),
            "quantity": Decimal("1.5"),
            "source": "ce",
            "as_of": now,
            "is_estimate": False,
        }
        for i in range(2_900)
    ]
    assert len({(r["day"], r["service"], r["usage_type"], r["record_type"]) for r in rows}) == len(rows)

    written = await usage.upsert_cloud_cost(db, rows)

    assert written == len(rows)
    db.expire_all()
    assert (await db.execute(select(func.count(CloudCostDaily.id)))).scalar() == len(rows)
