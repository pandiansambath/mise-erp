"""The AWS bill collector — the arithmetic half, over a real Cost Explorer capture.

    "why datas not shwiing...i thoguht previous month datas will show here..but
     nting ihsowing"

`/control-room/money` showed a dash and "AWS figures have never been fetched for
this period" because nothing in the app had ever called Cost Explorer. The fix
is `app/platform_admin/aws_bill.py`. These tests exist so that the SECOND way
that page can lie is never reintroduced, and it is a much quieter one than a
dash.

THE FAILURE THIS FILE GUARDS
----------------------------------------------------------------------------
Every cent this account spends is covered by promotional credit, and Cost
Explorer files that credit as a NEGATIVE ROW IN THE SAME RESULT SET as the
charge it offsets. Verified against the live account on 2026-09-16:

    July   usage $  9.22   credit -$  9.22   invoiced $0.00
    Aug    usage $ 41.91   credit -$ 41.91   invoiced $0.00
    Sept   usage $ 16.67   credit -$ 16.67   invoiced $0.00

So one unfiltered `GROUP BY SERVICE` sums the two together and returns $0.0000
for every service on the account. The page renders, every number is present,
nothing throws — and it says the platform is free. It is not free; it is about
three months from the credit running out on a plan whose `accountPlanType` is
already PAID, at which point the charges simply begin.

`_fetch_blocking` therefore makes TWO filtered calls and stores a `record_type`
per row. Anyone who "simplifies" that back into one call will make this file
red, which is the entire point of it.

THE FIXTURES ARE REAL, AND TRIMMED
----------------------------------------------------------------------------
`tests/fixtures/ce_charges.json` and `ce_credits.json` are a live capture of
`aws ce get-cost-and-usage` against account 887514555232, taken 2026-09-16.
They are TRIMMED — the full capture is 1.4MB — but nothing inside
`ResultsByTime` has been edited, and the trim is a whole-day one so the totals
stay arithmetically honest:

  · the WHOLE of July 2026 — the account's first month of billing, so its month
    total is complete and reconciles to the invoice figures above;
  · 2026-09-01 and 2026-09-15, for AWS's own `Estimated: true` flag;
  · two empty days, because Cost Explorer returns blocks with no groups at all
    for a day it has nothing for, and a collector that trips over one of those
    loses the run.

Nothing here calls AWS. `ce:GetCostAndUsage` is $0.01 a request and a test suite
that made one would be a test suite with a bill.

NONE OF THIS RUNS ON THE WINDOWS BOX. `tests/conftest.py` provisions a Postgres
database at import time for the whole package, so even these pure tests need
Postgres to be collected at all. Written for CI.
"""

import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from app.platform_admin import aws_bill
from app.platform_admin.aws_bill import _dedupe, _fetch_blocking, _rows_from, month_start

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _capture(name: str) -> list[dict]:
    """The `ResultsByTime` of a real Cost Explorer answer."""
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))["ResultsByTime"]


CHARGE_BLOCKS = _capture("ce_charges.json")
CREDIT_BLOCKS = _capture("ce_credits.json")


def stored_rows() -> list[dict]:
    """Exactly what `_fetch_blocking` would hand to the upsert, minus the API."""
    return _dedupe(
        _rows_from(CHARGE_BLOCKS, record_type="Usage")
        + _rows_from(CREDIT_BLOCKS, record_type=None)
    )


def total_of(rows: list[dict], *, month: str, record_type: str) -> Decimal:
    return sum(
        (r["amount_usd"] for r in rows
         if r["record_type"] == record_type and r["day"].isoformat().startswith(month)),
        Decimal("0"),
    )


# -- the credit that hides the bill ----------------------------------------


def test_the_credit_does_not_swallow_the_usage_it_offsets() -> None:
    """July is in this fixture in full, so its month total is the real invoice.

    Gross usage $9.22, credit -$9.22, net $0.00 — and all three are true at
    once. `net` below is precisely what a single unfiltered `GROUP BY SERVICE`
    would have returned: a rounding error, on a page whose only job is telling
    him what AWS costs. If this test ever reads `net` where it now reads
    `gross`, the money page has gone back to reporting a free platform.
    """
    rows = stored_rows()

    gross = total_of(rows, month="2026-07", record_type="Usage")
    credit = total_of(rows, month="2026-07", record_type="Credit")
    net = gross + credit

    assert round(gross, 2) == Decimal("9.22"), f"July gross usage is wrong: {gross}"
    assert round(credit, 2) == Decimal("-9.22"), f"July credit is wrong: {credit}"
    assert abs(net) < Decimal("0.0001"), f"the credit should cancel the usage almost exactly, got {net}"

    # The two facts the page shows side by side must not be the same number.
    assert gross > Decimal("9"), "gross usage collapsed towards the invoiced $0.00"


def test_the_bill_is_stored_split_into_charges_and_credits() -> None:
    """`record_type` is why `cloud_cost_daily` can answer both questions.

    "You will be invoiced $0.00" and "you are consuming $29 a month against
    $92.23 of credit" come out of the same table, and only because the charge
    rows and the credit rows are kept apart.
    """
    charges = _rows_from(CHARGE_BLOCKS, record_type="Usage")
    credits = _rows_from(CREDIT_BLOCKS, record_type=None)

    assert {r["record_type"] for r in charges} == {"Usage"}
    assert {r["record_type"] for r in credits} == {"Credit"}

    # A credit is not a thing you used, so it carries no usage type — that is
    # the reason the credits query spends its second GroupBy on RECORD_TYPE.
    assert {r["usage_type"] for r in credits} == {""}
    assert all(r["amount_usd"] < 0 for r in credits), "a credit row that is not negative is not a credit"
    assert all(r["source"] == "ce" for r in charges + credits)


def test_the_credits_query_keeps_credits_and_refunds_apart() -> None:
    """`record_type=None` means "take it from the group key".

    A Refund and a Credit are different money and the second group key is the
    only place that distinction survives. Merging them into one "Credit" lump
    is a one-character change and nothing else in the system would notice.
    """
    block = [{
        "TimePeriod": {"Start": "2026-08-04", "End": "2026-08-05"},
        "Estimated": False,
        "Groups": [
            {"Keys": ["Amazon Polly", "Credit"],
             "Metrics": {"UnblendedCost": {"Amount": "-1.50"}, "UsageQuantity": {"Amount": "0"}}},
            {"Keys": ["Amazon Polly", "Refund"],
             "Metrics": {"UnblendedCost": {"Amount": "-0.25"}, "UsageQuantity": {"Amount": "0"}}},
        ],
    }]
    rows = _dedupe(_rows_from(block, record_type=None))

    assert sorted(r["record_type"] for r in rows) == ["Credit", "Refund"]
    assert len(rows) == 2, "a refund was merged into the credit line"


# -- the key, and the batch Postgres refuses -------------------------------


def test_no_two_rows_in_one_batch_share_a_key() -> None:
    """One duplicate key loses the WHOLE day's bill, not one line of it.

    Postgres rejects an `ON CONFLICT DO UPDATE` whose own batch touches a row
    twice — "cannot affect row a second time" — and it fails the entire
    statement. The collector would then write a failure row and the page would
    go back to a dash, which is the bug this module was written to end.
    """
    rows = stored_rows()
    keys = [(r["day"], r["service"], r["usage_type"], r["record_type"]) for r in rows]

    assert len(keys) == len(set(keys)), "a duplicate key would fail the whole upsert"
    assert len(rows) > 400, "the fixture stopped producing rows — check the capture"


def test_every_value_fits_the_column_it_is_stored_in() -> None:
    """Truncation happens here, before the insert, not at the database.

    `service` is String(80), `usage_type` String(120), `record_type` String(20).
    A value that over-runs is not a warning in Postgres — it is a
    StringDataRightTruncation that fails the whole insert.
    """
    for r in stored_rows():
        assert len(r["service"]) <= 80, r["service"]
        assert len(r["usage_type"]) <= 120, r["usage_type"]
        assert len(r["record_type"]) <= 20, r["record_type"]


def test_two_services_that_truncate_alike_are_added_up_not_overwritten() -> None:
    """The collision is ours, not AWS's — we cut the key to 80 characters.

    Cost Explorer will never hand back two identical group keys. It will hand
    back two keys that differ only after character 80, and `_rows_from` cuts
    them to the width of the column. Bedrock keys are exactly that shape: the
    model name, and in provisioned form the region, live inside the service key.

    Summing is the only safe merge. Last-write-wins would silently drop one of
    two real charges, and understating the bill is the one direction this page
    is never allowed to be wrong in.
    """
    a = "Claude Sonnet 4.6 (Amazon Bedrock Edition) - Provisioned Throughput commitment, EU (London)"
    b = "Claude Sonnet 4.6 (Amazon Bedrock Edition) - Provisioned Throughput commitment, US (N. Virginia)"
    assert a != b and a[:80] == b[:80], "this test's own premise broke"

    block = [{
        "TimePeriod": {"Start": "2026-08-04", "End": "2026-08-05"},
        "Estimated": False,
        "Groups": [
            {"Keys": [a, "EUW2-MP:EUW2_InputTokenCount-Units"],
             "Metrics": {"UnblendedCost": {"Amount": "1.50"}, "UsageQuantity": {"Amount": "3"}}},
            {"Keys": [b, "EUW2-MP:EUW2_InputTokenCount-Units"],
             "Metrics": {"UnblendedCost": {"Amount": "2.25"}, "UsageQuantity": {"Amount": "4"}}},
        ],
    }]
    rows = _dedupe(_rows_from(block, record_type="Usage"))

    assert len(rows) == 1, "the truncated keys did not collide — the fixture, not the code, is wrong"
    assert rows[0]["amount_usd"] == Decimal("3.75"), "a colliding charge was overwritten instead of added"
    assert rows[0]["quantity"] == Decimal("7"), "the quantities were not added"


def test_a_merged_row_stays_an_estimate_if_either_half_was() -> None:
    """Merging must not launder a provisional figure into a settled one.

    Two rows collapse into one; one of them was AWS's estimate. The survivor
    has to keep the doubt, or the page presents a figure that can still move as
    a fact — and the chart shows a fall in spend that is really a half-finished
    day.
    """
    base = {
        "day": date(2026, 8, 4), "service": "Amazon Polly", "usage_type": "EUW2-SynthesizeSpeech",
        "record_type": "Usage", "quantity": Decimal("1"), "source": "ce",
        "as_of": datetime.now(UTC),
    }

    settled = dict(base, amount_usd=Decimal("1.00"), is_estimate=False)
    provisional = dict(base, amount_usd=Decimal("0.50"), is_estimate=True)
    assert _dedupe([settled, provisional])[0]["is_estimate"] is True

    # ...and in the other order, because an `or` is only written one way round.
    settled = dict(base, amount_usd=Decimal("1.00"), is_estimate=False)
    provisional = dict(base, amount_usd=Decimal("0.50"), is_estimate=True)
    assert _dedupe([provisional, settled])[0]["is_estimate"] is True


# -- the rows that are not worth storing -----------------------------------


def test_a_service_that_billed_nothing_and_used_nothing_is_not_stored() -> None:
    """Hundreds of services bill nothing every day.

    Storing them makes the table large and the page slow for no information.
    The fixture contains real ones — the `Tax` lines AWS emits at $0 against
    every Bedrock usage type on 2026-07-27 and 2026-09-01.
    """
    rows = stored_rows()

    assert not [r for r in rows if r["amount_usd"] == 0 and r["quantity"] == 0], \
        "a row carrying no information was stored"

    tax_noise = [
        g for b in CHARGE_BLOCKS for g in b.get("Groups", [])
        if g["Keys"][0] == "Tax"
        and Decimal(g["Metrics"]["UnblendedCost"]["Amount"]) == 0
        and Decimal(g["Metrics"]["UsageQuantity"]["Amount"]) == 0
    ]
    assert tax_noise, "the fixture no longer contains a zero row — this test proves nothing"


def test_a_service_that_was_free_but_used_is_still_stored() -> None:
    """Zero COST is not zero information.

    Most of `EC2 - Other` is inbound data transfer: real bytes, billed at
    nothing. Dropping every $0.00 row would delete the usage side of the page,
    and with it the evidence of what we were already doing on the day a charge
    for it finally appears.
    """
    free_but_used = [r for r in stored_rows() if r["amount_usd"] == 0 and r["quantity"] > 0]

    assert len(free_but_used) > 50, "free-but-used rows were dropped along with the empty ones"
    assert any("AWS-In-Bytes" in r["usage_type"] for r in free_but_used)


# -- what is settled, and what is not --------------------------------------


def test_today_is_never_stored_as_a_settled_figure() -> None:
    """A partial day must never be presented as a fact.

    AWS does not always set `Estimated` on today, so the module checks the date
    as well. Without that check the chart shows a half-finished today as a fall
    in spend, which is exactly the shape of thing somebody acts on.
    """
    today = datetime.now(UTC).date()
    block = [{
        "TimePeriod": {"Start": today.isoformat(), "End": (today + timedelta(days=1)).isoformat()},
        # NOTE: AWS says nothing here about the block being estimated.
        "Groups": [
            {"Keys": ["Amazon Relational Database Service", "EUW2-InstanceUsage:db.t4g.micro"],
             "Metrics": {"UnblendedCost": {"Amount": "0.21"}, "UsageQuantity": {"Amount": "12"}}},
        ],
    }]

    assert _rows_from(block, record_type="Usage")[0]["is_estimate"] is True


def test_a_block_aws_marks_estimated_is_stored_as_an_estimate() -> None:
    """AWS's own word for "not settled yet", on days long past.

    2026-09-01 and 2026-09-15 came back flagged. They are not today and never
    will be again, so the only thing that can make these rows estimates is the
    flag actually being read.
    """
    flagged = {
        b["TimePeriod"]["Start"]
        for b in CHARGE_BLOCKS
        if b.get("Estimated") and b.get("Groups")
    }
    assert flagged, "the fixture lost its Estimated blocks"

    rows = _rows_from(CHARGE_BLOCKS, record_type="Usage")
    for day in flagged:
        same_day = [r for r in rows if r["day"].isoformat() == day]
        assert same_day and all(r["is_estimate"] for r in same_day), f"{day} lost its estimate flag"


def test_a_settled_past_day_is_not_marked_an_estimate() -> None:
    """The other half of the same switch — or everything is an estimate and the
    word stops meaning anything on the page."""
    july = [r for r in _rows_from(CHARGE_BLOCKS, record_type="Usage")
            if r["day"].isoformat().startswith("2026-07")]

    assert july and not any(r["is_estimate"] for r in july)


def test_an_empty_day_is_not_an_error() -> None:
    """Cost Explorer returns a block with no groups for a day it has nothing
    for — the fixture has two. A collector that assumes every block has groups
    dies on the first quiet day and takes the whole fetch with it."""
    empty = [b for b in CHARGE_BLOCKS if not b.get("Groups")]
    assert empty, "the fixture lost its empty blocks"

    assert _rows_from(empty, record_type="Usage") == []


# -- what the service key carries ------------------------------------------


def test_the_bedrock_model_name_survives_inside_the_service_key() -> None:
    """Bedrock bills as "Claude Sonnet 4.6 (Amazon Bedrock Edition)".

    The model name is INSIDE the service key, so the key MOVES every time we
    change model. Nothing may hardcode it; the page matches on "Bedrock". This
    pins that the key arrives whole, with the model in it, and shows the next
    person why `service` is 80 characters wide.
    """
    services = {r["service"] for r in stored_rows()}
    bedrock = {s for s in services if "Bedrock" in s}

    assert len(bedrock) >= 2, f"Bedrock lines vanished from the bill: {sorted(services)}"
    assert any("Claude" in s for s in bedrock), "the model name is no longer in the service key"


def test_ec2_other_keeps_the_usage_type_that_says_which_half_it_is() -> None:
    """`EC2 - Other` is two unrelated things sharing one service name.

    EBS volumes belong to the box; data transfer out belongs to the platform's
    traffic. USAGE_TYPE is the only thing that separates them, and it is why
    the charges query spends its second (and last) GroupBy slot on it rather
    than on RECORD_TYPE.
    """
    ec2_other = [r for r in stored_rows()
                 if r["service"] == "EC2 - Other" and r["record_type"] == "Usage"]

    assert any("EBS" in r["usage_type"] for r in ec2_other), "the EBS line lost its usage type"
    assert any("Out-Bytes" in r["usage_type"] for r in ec2_other), "data transfer lost its usage type"
    assert all(r["usage_type"] for r in ec2_other), \
        "an EC2 - Other row cannot be attributed without a usage type"


# -- the calendar ----------------------------------------------------------


def test_month_start_walks_back_over_the_year_boundary() -> None:
    """January minus two months is November of the year before.

    `BACKFILL_MONTHS` is 2, so on any 1st of January the first ever run asks
    for a window that starts in the previous year. Getting this wrong mostly
    does not raise — it fetches the wrong window and quietly shows nothing for
    "previous month", which is the original complaint all over again.
    """
    assert month_start(date(2026, 1, 15), 2) == date(2025, 11, 1)
    assert month_start(date(2026, 1, 1), 1) == date(2025, 12, 1)
    assert month_start(date(2026, 1, 31)) == date(2026, 1, 1)
    assert month_start(date(2026, 3, 31), 1) == date(2026, 2, 1)
    assert month_start(date(2026, 9, 16), 2) == date(2026, 7, 1)
    # A whole year and more back — what a longer backfill would ask for.
    assert month_start(date(2026, 2, 10), 12) == date(2025, 2, 1)
    assert month_start(date(2026, 2, 10), 14) == date(2024, 12, 1)


# -- the two calls ---------------------------------------------------------


class FakeCE:
    """A Cost Explorer that answers from the captured fixtures.

    It also records every request, because WHAT WE ASK FOR is the thing under
    test: two calls, each filtered by RECORD_TYPE. Never one unfiltered one.
    """

    def __init__(self, *, page_charges_twice: bool = False) -> None:
        self.requests: list[dict] = []
        self._page_charges_twice = page_charges_twice

    def get_cost_and_usage(self, **kw):
        self.requests.append(dict(kw))
        wants_credits = "Not" not in kw.get("Filter", {})
        blocks = CREDIT_BLOCKS if wants_credits else CHARGE_BLOCKS

        if not wants_credits and self._page_charges_twice:
            half = len(blocks) // 2
            if "NextPageToken" not in kw:
                return {"ResultsByTime": blocks[:half], "NextPageToken": "page-2"}
            return {"ResultsByTime": blocks[half:]}
        return {"ResultsByTime": blocks}


@pytest.fixture
def fake_ce(monkeypatch):
    """Install a fake Cost Explorer. boto3 is never imported, never called."""

    def _install(**kw) -> FakeCE:
        client = FakeCE(**kw)
        monkeypatch.setattr(aws_bill, "_ce_client", lambda: client)
        return client

    return _install


def test_the_bill_is_two_filtered_calls_never_one_unfiltered_one(fake_ce) -> None:
    """The shape of the request IS the fix.

    One call grouped by SERVICE comes back $0.0000 across the board on this
    account. Two calls — charges with credits excluded, credits on their own —
    is what makes both numbers on the page true. Cost Explorer allows only two
    GroupBy dimensions per call, so this cannot be collapsed into one however
    tempting the saved cent looks.
    """
    client = fake_ce()

    rows, calls = _fetch_blocking(date(2026, 7, 23), date(2026, 7, 31))

    assert calls == 2, "the number of calls billed is what the ceiling counts"
    assert len(client.requests) == 2

    charges, credits = client.requests
    assert charges["GroupBy"] == [
        {"Type": "DIMENSION", "Key": "SERVICE"},
        {"Type": "DIMENSION", "Key": "USAGE_TYPE"},
    ]
    assert charges["Filter"] == {
        "Not": {"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Credit", "Refund"]}}
    }, "the charges query stopped excluding credits — every service will now read $0.0000"

    assert credits["GroupBy"] == [
        {"Type": "DIMENSION", "Key": "SERVICE"},
        {"Type": "DIMENSION", "Key": "RECORD_TYPE"},
    ]
    assert credits["Filter"] == {"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Credit", "Refund"]}}

    for req in client.requests:
        assert req["Granularity"] == "DAILY"
        assert req["Metrics"] == ["UnblendedCost", "UsageQuantity"]

    # And the effect of asking that way: both sides of the bill, deduped.
    assert {r["record_type"] for r in rows} == {"Usage", "Credit"}
    assert round(total_of(rows, month="2026-07", record_type="Usage"), 2) == Decimal("9.22")


def test_the_last_day_asked_for_is_not_dropped_from_the_bill(fake_ce) -> None:
    """Cost Explorer's End is EXCLUSIVE; every other range in this app is not.

    The conversion happens in one place. An off-by-one here silently drops
    today from the bill — a page quietly a day short, on the day somebody is
    looking at it to decide something.
    """
    client = fake_ce()

    _fetch_blocking(date(2026, 7, 1), date(2026, 9, 16))

    for req in client.requests:
        assert req["TimePeriod"] == {"Start": "2026-07-01", "End": "2026-09-17"}


def test_every_page_of_a_paginated_answer_is_counted_as_a_billed_call(fake_ce) -> None:
    """Pagination is not free — every NextPageToken round trip is another cent.

    Today's volumes fit in one page each. When they stop fitting, the ceiling
    must still be counting what we actually spent, or the one brake that is
    arithmetic rather than a promise quietly becomes a promise.
    """
    client = fake_ce(page_charges_twice=True)

    rows, calls = _fetch_blocking(date(2026, 7, 1), date(2026, 9, 16))

    assert calls == 3, "a paginated fetch billed 3 requests and reported fewer"
    assert len(client.requests) == 3
    # Both pages made it into the result, not just the last one.
    assert round(total_of(rows, month="2026-07", record_type="Usage"), 2) == Decimal("9.22")
