"""DineAI API — FastAPI application entrypoint."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.health import router as health_router
from app.api.site import router as site_router
from app.assistant.router import router as assistant_router
from app.audit.router import router as audit_router
from app.auth.roles_router import router as roles_router
from app.auth.router import router as auth_router
from app.billing.router import router as billing_router
from app.core import logging_setup, monitoring, usage
from app.core.config import settings
from app.core.pulse import PULSE
from app.custom_fields.router import router as custom_fields_router
from app.documents.comments import router as doc_comments_router
from app.documents.router import router as documents_router
from app.employees.router import attendance_router
from app.employees.router import router as employees_router
from app.events.router import router as events_router
from app.expenses.router import router as expenses_router
from app.hotels.router import router as hotels_router
from app.inventory.router import router as inventory_router
from app.jobs.router import public_router as jobs_public_router
from app.jobs.router import router as jobs_router
from app.notifications.router import router as notifications_router
from app.ordering.rider_router import rider_router
from app.ordering.router import kds_router as kitchen_screen_router
from app.ordering.router import public_router as ordering_public_router
from app.ordering.router import router as ordering_router
from app.ordering.router import table_router as dine_in_table_router
from app.party.router import router as party_router
from app.payroll.router import router as payroll_router
from app.platform_admin.models import OPERATOR_HOTEL
from app.platform_admin.router import router as platform_router
from app.purchasing.router import router as purchasing_router
from app.recipes.router import router as recipes_router
from app.reports.router import router as reports_router
from app.rota.router import router as rota_router
from app.safety.router import router as safety_router
from app.sales.router import router as sales_router
from app.selfservice.router import router as selfservice_router
from app.talent.router import public_router as talent_public_router
from app.talent.router import router as talent_router
from app.teamchat.router import router as teamchat_router
from app.vendors.router import router as vendors_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the usage flusher, and make sure a deploy loses nothing.

    The counters live in memory (see `app/core/usage.py` for why). A normal
    deploy is `docker compose up -d`, which sends SIGTERM and runs this
    shutdown path — so the flush below is what makes "a deploy loses no counts"
    true rather than hopeful. Only a hard kill loses the last few minutes, and
    the page can see that gap because every flush stamps `last_flush`.

    OFF IN TESTS. The suite is 812 tests and 27 minutes; a background task and
    a collector inside it would be a slow, confusing failure that has nothing
    to do with what is being tested.
    """
    import asyncio
    import contextlib
    import sys

    from app.core import usage
    from app.core.database import AsyncSessionLocal, engine

    # `settings.env` DOES NOT EXIST — I wrote against it first and a
    # getattr default would have quietly switched the collector ON inside the
    # test suite, which is the opposite of the intent. pytest announces itself
    # in sys.modules; that is true whatever the config happens to hold.
    enabled = "pytest" not in sys.modules

    if enabled:
        with contextlib.suppress(Exception):
            usage.attach_db_counters(engine.sync_engine)

    async def _flush_once() -> None:
        with contextlib.suppress(Exception):
            async with AsyncSessionLocal() as db:
                await usage.flush(db)

    async def _aws_bill_once() -> None:
        """Ask AWS what it charged. TWICE A DAY, because it costs a cent a call.

        The first run of all reaches back two whole calendar months, so the
        money page has history the moment it exists rather than filling in over
        the following month — "i thoguht previous month datas will show here".

        Failures are swallowed on purpose: a Cost Explorer outage, an expired
        credential or a throttle must never take down an app that serves
        restaurants their orders. `aws_bill.fetch` writes its own failure row to
        `telemetry_sync`, so the dashboard SHOWS the gap instead of quietly
        drawing a flat line — which is the whole reason that table exists.
        """
        from app.platform_admin import aws_bill

        with contextlib.suppress(Exception):
            async with AsyncSessionLocal() as db:
                await aws_bill.fetch(db, reason="scheduled")

    async def _loop() -> None:
        # Five minutes. At sixty seconds this would be 1,440 upserts a day
        # touching the same few hundred rows; at five it is 288, which
        # autovacuum absorbs without noticing.
        while True:
            await asyncio.sleep(300)
            await _flush_once()

    async def _bill_loop() -> None:
        # Every six hours, which the collector's own cooldown then holds to
        # roughly four fetches a day at 2 calls each: about $2.40 a month to
        # keep a $30 bill on screen. The cooldown is the real limit; this
        # interval only decides how often we ASK to be allowed.
        #
        # A short first delay, not an immediate call: the box has just booted
        # and the first thing it owes anyone is health checks, not a 3-second
        # round trip to us-east-1.
        await asyncio.sleep(90)
        while True:
            await _aws_bill_once()
            await asyncio.sleep(6 * 3600)

    task = asyncio.create_task(_loop()) if enabled else None
    bill_task = asyncio.create_task(_bill_loop()) if enabled else None
    try:
        yield
    finally:
        if bill_task is not None:
            bill_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await bill_task
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await _flush_once()


def create_app() -> FastAPI:
    # One log format everywhere, before anything can log.
    logging_setup.configure(getattr(settings, "log_level", "INFO"))
    # Before the app exists, so a failure during construction is still reported.
    monitoring.init()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        lifespan=lifespan,
    )

    # We authenticate with Bearer tokens (no cookies), so a "*" origin is safe;
    # browsers forbid credentials + "*", so only enable credentials for explicit origins.
    _wildcard = "*" in settings.cors_origins
    def _template(path: str) -> str:
        """/api/hotels/9f3c…/staff -> /api/hotels/{id}/staff.

        Without this, every id becomes its own endpoint: the slowest-endpoint
        list fills with one-call rows and the genuinely slow route never rises
        to the top.
        """
        out = []
        for seg in path.split("/"):
            if len(seg) >= 8 and any(c.isdigit() for c in seg) and any(
                c in "-abcdef0123456789" for c in seg.lower()
            ) and all(c in "-abcdefABCDEF0123456789" for c in seg):
                out.append("{id}")
            else:
                out.append(seg)
        return "/".join(out)

    @app.middleware("http")
    async def _log_context(request, call_next):
        """Bind hotel + user to every log line this request produces.

        Done here so nothing has to thread the hotel down through five layers of
        call just to be searchable. The handle (not the UUID) is what support
        can read off a customer's URL.
        """
        import time as _time
        import uuid as _uuid

        rid = _uuid.uuid4().hex[:8]
        logging_setup.bind(request_id=rid)
        # Opens the per-request DB tally that the SQLAlchemy events fill in.
        # Must be before call_next, or the first queries of the request are
        # counted against nobody.
        usage.begin_request()
        started = _time.monotonic()
        try:
            response = await call_next(request)
            # Our OWN access line, written here rather than left to uvicorn.
            #
            # Uvicorn logs the request after this middleware has finished, in a
            # context where our ContextVars are already cleared - which is why
            # every access line in CloudWatch read `hotel=- user=- req=-` and
            # could not be tied to a customer or to each other. That made the
            # logs almost useless for the thing they exist for.
            # Identity resolved inside the endpoint's task; see deps.py.
            logging_setup.bind(
                hotel=getattr(request.state, "log_hotel", None),
                user=getattr(request.state, "log_user", None),
            )
            ms = int((_time.monotonic() - started) * 1000)
            path = request.url.path
            # `/api/health`, NOT `/health`. The health router is mounted under
            # the `/api` prefix, so this prefix test never matched it and every
            # 30-second load-balancer probe was recorded as a real request with
            # no hotel — landing in the anonymous bucket and inflating it to
            # 72% of all traffic. A skip-list that does not match the thing it
            # names is worse than no skip-list, because everyone believes it.
            if not path.startswith(("/health", "/api/health", "/static", "/_next")):
                # One deque append. The Control Room's health page is built
                # from this — reading it back out of CloudWatch would need IAM
                # the app does not have and would be billed per GB scanned.
                # Templated so /api/hotels/<uuid> does not become 400 distinct
                # "endpoints" that each look rare.
                templated = _template(path)
                PULSE.record(templated, response.status_code, ms)
                # The same event, kept for the BILL rather than for health.
                # pulse resets on deploy by design; this one survives.
                usage.end_request(
                    # PLATFORM TRAFFIC IS NOT A RESTAURANT'S TRAFFIC. An
                    # operator is always signed in as a user of some hotel, so
                    # without this every Control Room page load was billed to
                    # whichever restaurant the operator happens to belong to.
                    hotel_id=(
                        str(OPERATOR_HOTEL)
                        if path.startswith("/api/platform")
                        else getattr(request.state, "log_hotel", None)
                    ),
                    method=request.method,
                    endpoint=templated,
                    status=response.status_code,
                    ms=ms,
                )
                log.info(
                    "%s %s -> %s in %dms",
                    request.method,
                    path,
                    response.status_code,
                    ms,
                )
        finally:
            logging_setup.clear()
        response.headers["X-Request-Id"] = rid
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=not _wildcard,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router, prefix="/api")
    app.include_router(site_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(roles_router, prefix="/api")
    app.include_router(teamchat_router, prefix="/api")
    app.include_router(billing_router, prefix="/api")
    app.include_router(ordering_router, prefix="/api")
    app.include_router(ordering_public_router, prefix="/api")
    # The QR-on-the-table flow. Public: a diner has no login.
    app.include_router(dine_in_table_router, prefix="/api")
    # The kitchen screen, opened by a long random link instead of a login.
    app.include_router(kitchen_screen_router, prefix="/api")
    app.include_router(rider_router, prefix="/api")
    app.include_router(talent_router, prefix="/api")
    app.include_router(talent_public_router, prefix="/api")
    app.include_router(audit_router, prefix="/api")
    app.include_router(inventory_router, prefix="/api")
    app.include_router(vendors_router, prefix="/api")
    app.include_router(custom_fields_router, prefix="/api")
    app.include_router(recipes_router, prefix="/api")
    app.include_router(party_router, prefix="/api")
    app.include_router(sales_router, prefix="/api")
    app.include_router(expenses_router, prefix="/api")
    app.include_router(reports_router, prefix="/api")
    app.include_router(safety_router, prefix="/api")
    app.include_router(rota_router, prefix="/api")
    app.include_router(employees_router, prefix="/api")
    app.include_router(attendance_router, prefix="/api")
    app.include_router(payroll_router, prefix="/api")
    app.include_router(purchasing_router, prefix="/api")
    app.include_router(documents_router, prefix="/api")
    app.include_router(doc_comments_router, prefix="/api")
    app.include_router(selfservice_router, prefix="/api")
    app.include_router(hotels_router, prefix="/api")
    app.include_router(events_router, prefix="/api")
    app.include_router(assistant_router, prefix="/api")
    app.include_router(notifications_router, prefix="/api")
    app.include_router(platform_router, prefix="/api")
    app.include_router(jobs_router, prefix="/api")
    app.include_router(jobs_public_router, prefix="/api")

    @app.get("/", tags=["root"])
    async def root() -> dict:
        return {"name": settings.app_name, "version": __version__, "status": "ok"}

    return app


log = logging.getLogger("mise.http")

app = create_app()
