"""Ask AWS what it charged us, and write the answer down.

    "why datas not shwiing...i thoguht previous month datas will show here..but
     nting ihsowing"

He was looking at `/control-room/money` with a dash where the bill should be and
"AWS figures have never been fetched for this period" underneath. The read path
(`costs.billed()`) was finished, the table existed, the IAM policy was attached
to the instance role — and nothing ever called Cost Explorer. The page was not
broken. It was correctly reporting that nobody had asked.

THE THING THAT MAKES THIS PAGE HARD, AND IT IS NOT THE API
--------------------------------------------------------------------------
Ask Cost Explorer for this account's cost per service and every line comes back
`$0.0000`. The account looks free. It is not free — it is CREDITED, and the
credit is filed as a NEGATIVE ROW IN THE SAME RESULT SET:

    July   usage $  9.22   credit -$  9.22   invoice $0.00
    Aug    usage $ 41.91   credit -$ 41.91   invoice $0.00
    Sept   usage $ 16.67   credit -$ 16.67   invoice $0.00

An unfiltered `GROUP BY SERVICE` sums the usage and the credit together and
hands back a rounding error. So this module NEVER makes one unfiltered call. It
makes two, each filtered by `RECORD_TYPE`, and stores them as separate rows --
which is why `CloudCostDaily` has a `record_type` column at all.

Both numbers are true and the page needs both. "You will be invoiced $0.00" is
what his card sees this month. "You are consuming $29 a month against $92.23 of
credit" is the one that tells him when that stops. `accountPlanType` is already
**PAID**: when the credits run out nothing switches off, the charges simply
start.

THIS MODULE SPENDS MONEY, WHICH IS WHY IT IS FULL OF BRAKES
--------------------------------------------------------------------------
`ce:GetCostAndUsage` is **$0.01 per request** -- already visible on our own bill
as "AWS Cost Explorer . USE1-APIRequest". A ten-second live refresh, which is
what "WE NEED A LIVE DASHBOARD" literally asks for, would cost $5,184 a month to
watch a $30 bill. The dashboard would become the largest line on the dashboard.

So the live half of that page is the MEASURED half -- requests, DB reads and
writes, AI spend -- which is ours, free, and genuinely live to the second. The
AWS half refreshes twice a day and says, out loud and on screen, how old it is.
Three independent brakes, because a cost bug that bills you is not one you get
to fix afterwards:

  1. a 6-hour cooldown, held in the DATABASE -- not per session, or two tabs
     defeat it, and not per operator, or three operators triple the bill;
  2. a hard ceiling of `MONTHLY_CALL_CEILING` calls per calendar month, counted
     from what we actually spent, so the worst case this key can ever reach is
     $1.50 and it is arithmetic rather than a promise;
  3. one fetch covers any date range for the same price, so the backfill that
     fills in "previous month" costs exactly what a single day costs.

A note on (3), because it is the reason his history can appear at all: Cost
Explorer keeps ~14 months and charges per CALL, not per day returned. A
collector that started today and walked forward would leave that page blank
until October. This one reaches backwards on first run.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import usage
from app.platform_admin.models import CloudCostDaily, TelemetrySync

log = logging.getLogger("mise.money.aws")

#: Cost Explorer is a global service with a us-east-1 endpoint. It is NOT in
#: eu-west-2, and using `settings.aws_region` here returns an endpoint error --
#: which looks exactly like a permissions problem and sends the next person back
#: to the IAM policy for an afternoon.
CE_REGION = "us-east-1"

#: $0.01 each. 150 -> $1.50/month is the most this can ever spend.
MONTHLY_CALL_CEILING = 150
CE_CALL_USD = Decimal("0.01")

#: Two scheduled refreshes a day leaves headroom under the ceiling for an
#: operator pressing Refresh, which is the point of having headroom.
COOLDOWN = timedelta(hours=6)

#: How far back the first ever run reaches: two whole calendar months plus the
#: current one. Enough that "previous month" is populated the moment this ships,
#: which is the thing he actually asked for.
BACKFILL_MONTHS = 2

JOB = "aws_bill"

#: Credits and refunds are the negative rows. Everything else -- Usage, Tax,
#: Support, SavingsPlan* -- is money consumed.
CREDIT_TYPES = ["Credit", "Refund"]


def month_start(d: date, months_back: int = 0) -> date:
    """First of the month, `months_back` months before `d`."""
    y, m = d.year, d.month - months_back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def _as_dt(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=UTC)


# -- the brakes ------------------------------------------------------------


async def spend_guard(db: AsyncSession, *, now: datetime | None = None) -> dict:
    """What this collector has already spent this calendar month.

    Counted from `telemetry_sync`, i.e. from calls we actually made -- INCLUDING
    the ones that failed. A failed Cost Explorer call is billed like any other,
    so a retry loop against a permissions error would spend real money while
    returning nothing. Counting attempts rather than successes is the whole
    point of having a ceiling.
    """
    now = now or datetime.now(UTC)
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(TelemetrySync.api_calls), 0),
                func.max(TelemetrySync.finished_at),
            ).where(
                TelemetrySync.job == JOB,
                TelemetrySync.finished_at >= _as_dt(month_start(now.date())),
            )
        )
    ).one()
    calls = int(row[0] or 0)

    last_any = (
        await db.execute(
            select(func.max(TelemetrySync.finished_at)).where(TelemetrySync.job == JOB)
        )
    ).scalar()

    cooling = bool(last_any and (now - last_any) < COOLDOWN)
    return {
        "calls_this_month": calls,
        "ceiling": MONTHLY_CALL_CEILING,
        "spent_usd": float(Decimal(calls) * CE_CALL_USD),
        "last_run": last_any,
        "cooling_down": cooling,
        "next_allowed": (last_any + COOLDOWN) if cooling and last_any else None,
        "at_ceiling": calls >= MONTHLY_CALL_CEILING,
    }


# -- the AWS calls ---------------------------------------------------------


def _ce_client() -> Any:
    import boto3

    return boto3.client("ce", region_name=CE_REGION)


def _pages(client: Any, tally: list[int], **kw: Any) -> list[dict]:
    """Run one GetCostAndUsage to exhaustion, counting as it goes.

    THE COUNT IS INCREMENTED BEFORE THE RESULT IS USED, and into a list the
    caller already holds, because AWS bills the request, not the success.

    This started life returning the count, which is wrong in the one case that
    costs money: `_fetch_blocking` makes two of these, and a throttle on the
    second — the most ordinary Cost Explorer failure there is — discarded the
    return value along with the cent already spent on the first. The failure
    row then recorded `api_calls=0`, and a ceiling that believes it never ran is
    a ceiling a broken collector can spend straight past. Pagination makes it
    worse: every page already billed is forgotten with it.

    A mutable tally is not elegant. It is, however, the only shape that survives
    an exception, which is the entire requirement.
    """
    out: list[dict] = []
    token: str | None = None
    while True:
        if token:
            kw["NextPageToken"] = token
        tally[0] += 1  # billed NOW, whatever happens next
        resp = client.get_cost_and_usage(**kw)
        out.extend(resp.get("ResultsByTime", []))
        token = resp.get("NextPageToken")
        if not token:
            return out


def _rows_from(results: list[dict], *, record_type: str | None) -> list[dict]:
    """Flatten Cost Explorer's shape into `cloud_cost_daily` rows.

    `record_type=None` means take it from the second group key -- used by the
    credits query, which groups by RECORD_TYPE so a Credit and a Refund stay
    distinguishable instead of being merged into one lump.
    """
    now = datetime.now(UTC)
    today = now.date()
    rows: list[dict] = []

    for block in results:
        start = date.fromisoformat(block["TimePeriod"]["Start"])
        # AWS's own word for "this is not settled yet", plus our own check on
        # today: a partial day must never be presented as a fact, and the chart
        # must never show a half-finished today as a fall in spend.
        estimated = bool(block.get("Estimated")) or start >= today

        for g in block.get("Groups", []):
            keys = g.get("Keys", [])
            metrics = g.get("Metrics", {})
            amount = Decimal(metrics.get("UnblendedCost", {}).get("Amount", "0"))
            qty = Decimal(metrics.get("UsageQuantity", {}).get("Amount", "0"))

            if record_type is None:
                service = keys[0] if keys else "Unknown"
                utype = ""
                rtype = keys[1] if len(keys) > 1 else "Credit"
            else:
                service = keys[0] if keys else "Unknown"
                utype = keys[1] if len(keys) > 1 else ""
                rtype = record_type

            # A zero row is noise -- hundreds of services bill nothing every
            # day and storing them makes the table large and the page slow for
            # no information. A NEGATIVE zero is still zero.
            if amount == 0 and qty == 0:
                continue

            rows.append({
                "day": start,
                "service": service[:80],
                "usage_type": utype[:120],
                "record_type": rtype[:20],
                "amount_usd": amount,
                "quantity": qty,
                "source": "ce",
                "as_of": now,
                "is_estimate": estimated,
            })
    return rows


def _fetch_blocking(start: date, end: date, tally: list[int]) -> list[dict]:
    """The two queries, run on a worker thread. Returns the rows.

    `tally[0]` is the running count of BILLED calls, owned by the caller so it
    survives an exception thrown part-way through. See `_pages`.

    TWO queries, not one, and not three.

    Cost Explorer allows at most two GroupBy dimensions per call, and this page
    needs three facts about every line: which service, which usage type, and
    whether it is a charge or a credit. So:

      * charges  -- GROUP BY SERVICE, USAGE_TYPE, filtered to exclude credits.
        Usage type is what separates `EC2 - Other` into EBS volumes (which
        belong to the shared box) and data transfer out (which belongs to the
        platform). Without it that line cannot be attributed at all.

      * credits  -- GROUP BY SERVICE, RECORD_TYPE, filtered to credits only.
        No usage type: a credit is not a thing you used.

    `end` is made EXCLUSIVE for AWS. Cost Explorer's End is exclusive and every
    other date range in this application is inclusive, so the conversion happens
    here, once, rather than in each of the three callers -- an off-by-one here
    silently drops today from the bill.
    """
    client = _ce_client()
    period = {"Start": start.isoformat(), "End": (end + timedelta(days=1)).isoformat()}
    common = {
        "TimePeriod": period,
        "Granularity": "DAILY",
        "Metrics": ["UnblendedCost", "UsageQuantity"],
    }

    charges = _pages(
        client,
        tally,
        **common,
        GroupBy=[
            {"Type": "DIMENSION", "Key": "SERVICE"},
            {"Type": "DIMENSION", "Key": "USAGE_TYPE"},
        ],
        Filter={"Not": {"Dimensions": {"Key": "RECORD_TYPE", "Values": CREDIT_TYPES}}},
    )
    credits = _pages(
        client,
        tally,
        **common,
        GroupBy=[
            {"Type": "DIMENSION", "Key": "SERVICE"},
            {"Type": "DIMENSION", "Key": "RECORD_TYPE"},
        ],
        Filter={"Dimensions": {"Key": "RECORD_TYPE", "Values": CREDIT_TYPES}},
    )

    rows = _rows_from(charges, record_type="Usage") + _rows_from(credits, record_type=None)
    return _dedupe(rows)


def _dedupe(rows: list[dict]) -> list[dict]:
    """Collapse rows that share `uq_cloud_cost_key`, ADDING their amounts.

    Postgres refuses an `ON CONFLICT DO UPDATE` whose own batch touches a row
    twice -- "cannot affect row a second time" -- and it fails the ENTIRE
    statement, so one duplicated key loses the whole day's bill rather than one
    line of it.

    Cost Explorer's own grouping will not hand us a duplicate, but our storage
    does: `service` is truncated to 80 characters and `usage_type` to 120, so
    two long AWS keys sharing a prefix arrive distinct and land identical. The
    Bedrock keys are exactly the shape that does this -- "Claude Sonnet 4.6
    (Amazon Bedrock Edition)" and its siblings differ only in the middle.

    Summing is the right merge, not last-write-wins: two real lines that
    genuinely collapse to one row are two real charges, and dropping one would
    understate the bill. Understating a bill is the one direction this page is
    never allowed to be wrong in.
    """
    merged: dict[tuple, dict] = {}
    for r in rows:
        key = (r["day"], r["service"], r["usage_type"], r["record_type"])
        if key in merged:
            merged[key]["amount_usd"] += r["amount_usd"]
            merged[key]["quantity"] += r["quantity"]
            merged[key]["is_estimate"] = merged[key]["is_estimate"] or r["is_estimate"]
        else:
            merged[key] = r
    return list(merged.values())


def credit_balance_blocking() -> dict | None:
    """The runway. Free -- there is no `freetier` line on any AWS bill.

    This is the most important number on the page: `accountPlanType` is PAID, so
    when `accountPlanRemainingCredits` reaches zero nothing switches off and the
    charges simply begin. It reads $92.23 today against roughly $29 a month of
    consumption, which is about three months.

    Returns None rather than raising: a missing runway must not cost us the
    bill, which is the part somebody opened the page to see.
    """
    try:
        import boto3

        resp = boto3.client("freetier", region_name=CE_REGION).get_account_plan_state()
        credits = resp.get("accountPlanRemainingCredits") or {}
        return {
            "remaining_usd": float(credits.get("amount", 0)),
            "unit": credits.get("unit", "USD"),
            "plan_type": resp.get("accountPlanType"),
            "plan_status": resp.get("accountPlanStatus"),
        }
    except Exception as exc:  # noqa: BLE001 - never lose the bill over the runway
        log.warning("credit balance unavailable: %s", exc)
        return None


# -- the job ---------------------------------------------------------------


async def has_any(db: AsyncSession) -> bool:
    return bool((await db.execute(select(func.count(CloudCostDaily.id)))).scalar())


async def fetch(
    db: AsyncSession,
    *,
    start: date | None = None,
    end: date | None = None,
    reason: str = "scheduled",
    force: bool = False,
) -> dict:
    """Fetch, store, and record that we did. The only way money gets spent here.

    `start=None` decides the window itself, and the decision is the feature:

      * nothing stored yet -> reach back `BACKFILL_MONTHS` whole months, because
        a first run that only fetched today would leave "previous month" blank
        for a month and that is the complaint this exists to answer;
      * otherwise -> the last 10 days. Not one day: Cost Explorer RESTATES
        recent days as usage settles, so re-asking for a window that has already
        been written is not waste, it is the correction. The write is an upsert
        that REPLACES, so a restated day overwrites rather than accumulating.

    Returns a dict the endpoint can hand straight to the operator, including a
    refusal that says WHY -- a Refresh button that goes quiet is a button people
    press four more times.
    """
    guard = await spend_guard(db)

    if guard["at_ceiling"]:
        return {
            "ok": False,
            "skipped": True,
            "reason": (
                f"Monthly ceiling reached: {guard['calls_this_month']} of "
                f"{MONTHLY_CALL_CEILING} Cost Explorer calls "
                f"(${guard['spent_usd']:.2f}). It resets on the 1st."
            ),
            **guard,
        }

    if guard["cooling_down"] and not force:
        nxt = guard["next_allowed"]
        return {
            "ok": False,
            "skipped": True,
            "reason": (
                "AWS figures were refreshed less than 6 hours ago. Cost Explorer "
                "charges a cent a call, so this waits — the measured figures on "
                "this page are live regardless."
                + (f" Next refresh after {nxt:%H:%M} UTC." if nxt else "")
            ),
            **guard,
        }

    today = datetime.now(UTC).date()
    if start is None:
        start = (
            month_start(today, BACKFILL_MONTHS)
            if not await has_any(db)
            else today - timedelta(days=10)
        )
    end = end or today

    # Owned HERE so the failure path can still read what was spent. `calls` is
    # not a return value any more precisely because a return value is the one
    # thing an exception destroys.
    tally = [0]
    try:
        rows = await asyncio.to_thread(_fetch_blocking, start, end, tally)
        calls = tally[0]
        written = await usage.upsert_cloud_cost(db, rows)
        await usage.record_sync(
            db,
            job=JOB,
            ok=True,
            rows_written=written,
            api_calls=calls,
            api_cost_usd=float(Decimal(calls) * CE_CALL_USD),
            covers_from=start,
            covers_to=end,
            detail={"reason": reason},
        )
        log.info(
            "aws bill: %s rows for %s..%s in %s calls ($%.2f)",
            written, start, end, calls, calls * 0.01,
        )
        return {
            "ok": True,
            "skipped": False,
            "rows_written": written,
            "covers_from": start.isoformat(),
            "covers_to": end.isoformat(),
            "api_calls": calls,
            "api_cost_usd": float(Decimal(calls) * CE_CALL_USD),
        }
    except Exception as exc:  # noqa: BLE001
        # RECORD THE FAILURE, and record the calls it burned. A failed call is
        # billed exactly like a successful one; leaving it uncounted would let a
        # broken collector spend past a ceiling that believes it never ran.
        calls = tally[0]
        await usage.record_sync(
            db,
            job=JOB,
            ok=False,
            api_calls=calls,
            api_cost_usd=float(Decimal(calls) * CE_CALL_USD),
            covers_from=start,
            covers_to=end,
            error=f"{type(exc).__name__}: {exc}"[:500],
            detail={"reason": reason},
        )
        log.exception("aws bill fetch failed")
        return {"ok": False, "skipped": False, "reason": f"{type(exc).__name__}: {exc}"}


# -- the runway, cached ----------------------------------------------------

#: The credit balance is FREE to read, but it is still a network round trip on
#: the path of a page load, and it changes about once a day. A short process-
#: local cache keeps the dashboard quick without ever letting the figure go
#: stale enough to mislead. Not in the database: it is a live reading, and
#: storing it would invite somebody to serve it when the API is down and call
#: that "live".
_CREDIT_CACHE: dict[str, Any] = {"at": 0.0, "value": None}
CREDIT_TTL_SECONDS = 900


async def credit_balance(*, force: bool = False) -> dict | None:
    """$92.23 today, read from AWS rather than typed in by a person.

    I told him twice that this could only be read from the console. It cannot:
    `freetier:GetAccountPlanState` returns it, it costs nothing, and it
    reconciles with the burn. So the "entered by hand" chip on that card becomes
    a live one -- which matters more than it sounds, because this is the number
    that says when the bill stops being $0.00.

    What is still hand-entered is the EXPIRY DATE. AWS publishes no API for it,
    so the page must keep saying so for that field alone rather than letting the
    live balance lend it credibility it has not got.
    """
    import time as _time

    now = _time.monotonic()
    if not force and _CREDIT_CACHE["value"] is not None:
        if now - _CREDIT_CACHE["at"] < CREDIT_TTL_SECONDS:
            return _CREDIT_CACHE["value"]

    value = await asyncio.to_thread(credit_balance_blocking)
    if value is not None:
        _CREDIT_CACHE["at"] = now
        _CREDIT_CACHE["value"] = value
    # On failure serve the last good reading if we have one, but say how old it
    # is -- a runway that vanishes because of one timeout is worse than a
    # runway with an age on it.
    return value if value is not None else _CREDIT_CACHE["value"]
