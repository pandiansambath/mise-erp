"""Platform-wide (operator) config — settings the operator controls from the
Control Room: plan price overrides + broadcast announcements."""
import uuid
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PlatformConfig(Base):
    __tablename__ = "platform_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # plan_key -> display price string (e.g. {"pro": "£89/mo"}). Missing = code default.
    plan_prices: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    #: {balance_usd, expires_on, entered_by, entered_at}
    #:
    #: HAND-ENTERED, and the page says so. The BALANCE is readable --
    #: freetier:GetAccountPlanState returns it -- but AWS did not populate
    #: accountPlanExpirationDate for this account, so the expiry still comes
    #: off the console. A figure a person typed must never be rendered as a
    #: measured one.
    aws_credits: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default="{}"
    )


class PlatformAnnouncement(Base):
    """Operator broadcast shown as a banner in every hotel's app shell until it
    expires or is deactivated. Dismissal is per-user, client-side."""

    __tablename__ = "platform_announcements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="info")  # info | warn
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DeletedHotel(Base):
    """One line per restaurant permanently removed.

    NOT a foreign key to `hotels`, and deliberately NOT kept in the hotel's own
    audit log: `purge()` empties `audit_logs` for the hotel it is deleting, so
    a note stored there would be destroyed by the very act it records. A
    deletion ledger has to outlive the deletion.
    """

    __tablename__ = "deleted_hotels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    hotel_name: Mapped[str] = mapped_column(String(160), nullable=False)
    handle: Mapped[str | None] = mapped_column(String(40))
    city: Mapped[str | None] = mapped_column(String(80))
    country: Mapped[str | None] = mapped_column(String(80))
    plan: Mapped[str | None] = mapped_column(String(20))
    deleted_by: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    reason: Mapped[str | None] = mapped_column(Text)
    # Where the copy went. Without it the "archived first" promise cannot be
    # checked afterwards, which is most of what makes it a promise.
    archive_key: Mapped[str | None] = mapped_column(String(255))
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    removed: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# -- the money dashboard's three tables ------------------------------------
#
# Decisions kept next to the columns, because each is one somebody will
# otherwise undo:
#
#  * usage_daily is a ROLLUP, not a row per request. A row per request is
#    ~43.8M rows and ~10.5 GB a year on a 20 GB disk, and puts a write on the
#    hot path of every read. This is ~370k rows and ~100 MB, written by one
#    UPSERT every five minutes. "Today" is composed as stored + the un-flushed
#    in-memory delta, so it is still live.
#  * NO FOREIGN KEY to hotels, deliberately. deletion.py derives its delete
#    plan from the live FK graph, so a table with no FK is untouched when a
#    tenant is deleted -- which is exactly right: deleting a restaurant must
#    not rewrite last month's bill.
#  * Anonymous traffic uses a SENTINEL uuid, never NULL. Postgres treats NULLs
#    as distinct in a unique constraint, so a nullable hotel_id would create a
#    new row on every flush and the UPSERT would never match -- a failure that
#    looks exactly like working code.


#: Public, diner and unauthenticated traffic. A real uuid so the unique
#: constraint behaves; all zeroes so it is obvious in a query result.
ANON_HOTEL = uuid.UUID("00000000-0000-0000-0000-000000000000")

#: US, running the Control Room — not a restaurant.
#:
#: Every operator is a user of SOME hotel, and `control@mise.app` happens to
#: belong to NIRAI. So every Control Room page load — including the money page
#: that reports it — was counted as NIRAI's traffic and inflated NIRAI's share
#: of the shared box. The page answering "who cost how much and why" was itself
#: one of the largest contributors to the answer.
#:
#: A request to `/api/platform/*` is platform traffic whoever signs it, so it
#: gets its own bucket: still counted, still visible, never billed to a
#: customer. All-ones so it is as obvious in a query result as ANON is.
OPERATOR_HOTEL = uuid.UUID("11111111-1111-1111-1111-111111111111")


class UsageDaily(Base):
    """What we measured, by day / hotel / endpoint.

    The single source of truth for every measured figure on the money
    dashboard: day-wise, week-wise, per hotel and per endpoint are all
    aggregations of this one table.
    """

    __tablename__ = "usage_daily"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    #: UTC. AWS bills in UTC, and the page says so rather than quietly mixing a
    #: London day with an AWS one.
    day: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    hotel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    method: Mapped[str] = mapped_column(String(8), nullable=False)
    #: The TEMPLATED path - /api/hotels/{id}/staff. Untemplated, every uuid
    #: becomes its own "endpoint" and the genuinely busy route never surfaces.
    endpoint: Mapped[str] = mapped_column(String(160), nullable=False)

    requests: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors_4xx: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors_5xx: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    db_selects: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    db_writes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    db_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    #: FLUSHED, not "updated". Order.updated_at taught us that a timestamp
    #: which moves on any write gets read as an event time; here moving on
    #: write is the whole point, so the name says so.
    flushed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("day", "hotel_id", "method", "endpoint", name="uq_usage_daily_key"),
        Index("ix_usage_daily_hotel_day", "hotel_id", "day"),
    )


class CloudCostDaily(Base):
    """What AWS says, cached.

    Hours behind by nature - Cost Explorer restates the last few days, which is
    why every write here is an UPSERT. Appending would double-count and the
    page would drift upward on every refresh: a bug that looks like growth.
    """

    __tablename__ = "cloud_cost_daily"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    day: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    #: The EXACT Cost Explorer SERVICE key, stored raw so it is auditable - and
    #: because it MOVES. Bedrock bills as "Claude Sonnet 4.6 (Amazon Bedrock
    #: Edition)": the model name is inside the service key, so it changes every
    #: time we change model. Never hardcode it; match on "Bedrock" in the key.
    service: Mapped[str] = mapped_column(String(80), nullable=False)
    usage_type: Mapped[str] = mapped_column(
        String(120), nullable=False, default="", server_default=""
    )
    #: Usage | Credit | Tax | Refund. Credits are what make "actually charged"
    #: $0.00 while gross usage is real, and both figures are true.
    record_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="Usage", server_default="Usage"
    )
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=0)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False, default=0)

    source: Mapped[str] = mapped_column(
        String(12), nullable=False, default="ce", server_default="ce"
    )
    #: When AWS says the figure was true, as opposed to when we asked. The page
    #: shows BOTH: "true as of 06:00 UTC, fetched 8 hours ago" is honest;
    #: "updated 2 min ago" on an 18-hour-old figure is the lie it must not tell.
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    #: Today is always partial.
    is_estimate: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    __table_args__ = (
        UniqueConstraint(
            "day", "service", "usage_type", "record_type", name="uq_cloud_cost_key"
        ),
    )


class TelemetrySync(Base):
    """One row per run of either collector.

    Two things this buys that nothing else does. A GAP IN COLLECTION becomes
    visible - a quiet day and a dead collector look identical otherwise, which
    is the billing equivalent of "page scrolls 0px". And the dashboard can show
    what it costs to run itself: Cost Explorer is $0.01 a call, and
    api_cost_usd sums to a real line on the real bill.
    """

    __tablename__ = "telemetry_sync"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    job: Mapped[str] = mapped_column(String(24), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rows_written: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    api_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    api_cost_usd: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False, default=0)
    covers_from: Mapped[date_type | None] = mapped_column(Date)
    covers_to: Mapped[date_type | None] = mapped_column(Date)
    error: Mapped[str | None] = mapped_column(Text)
    detail: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (Index("ix_telemetry_sync_job", "job", "started_at"),)
