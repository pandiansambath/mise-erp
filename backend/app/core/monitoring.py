"""Error reporting.

Until now an exception in production reached us exactly one way: a customer
noticed something was broken and said so. CloudWatch has the traceback, but
nobody reads CloudWatch at 21:00 on a Friday — and a restaurant hitting a 500
mid-service will not open a support ticket, they will just stop trusting the app.

This module sends unhandled exceptions to Sentry so we hear about them first.

Three decisions worth knowing about:

**It is off unless SENTRY_DSN is set.** No DSN, no client, no network calls, no
cost — the same gating used for Stripe, Resend and Bedrock. Dev and CI stay
silent, and enabling it in production is an env var, not a deploy.

**Expected failures are not errors.** A 401, a 403, a 404, a 402 from the
paywall, a 429 from the rate limiter — these are the app working correctly.
Reporting them would burn the free tier's 5k events/month within a day and
train us to ignore the alerts, which is worse than not having them.

**Customer data is scrubbed before it leaves the box.** Restaurant data is
somebody's business: staff pay, supplier prices, takings. Auth headers, cookies,
tokens and passwords are stripped, and AI message bodies never get attached —
they can quote payroll. What we keep is the shape of the failure, not its
contents.
"""
from __future__ import annotations

import logging

from app.core.config import settings

log = logging.getLogger("mise.monitoring")

# HTTP statuses that mean "the app correctly refused", not "the app broke".
_EXPECTED = {400, 401, 402, 403, 404, 409, 422, 429}

# Header/field names whose values must never leave the instance. Matched
# case-insensitively as substrings, so "X-Auth-Token" and "authorization" both
# hit on "auth".
_SECRET_HINTS = ("auth", "cookie", "token", "password", "secret", "key", "session")


def _scrub(event: dict, hint: dict) -> dict | None:
    """Strip anything sensitive; drop the event entirely if it is expected.

    Runs on every event before send. Returning None discards it.
    """
    exc = (hint or {}).get("exc_info")
    if exc:
        err = exc[1]
        # Starlette's HTTPException and our own subclasses carry status_code.
        status = getattr(err, "status_code", None)
        if isinstance(status, int) and status in _EXPECTED:
            return None

    request = event.get("request") or {}
    for bag in ("headers", "cookies", "env"):
        values = request.get(bag)
        if isinstance(values, dict):
            for name in list(values):
                if any(h in name.lower() for h in _SECRET_HINTS):
                    values[name] = "[scrubbed]"
    # Request bodies can contain a payroll run or an AI prompt quoting one.
    # The URL and status tell us where it broke; the body is not worth the risk.
    request.pop("data", None)
    return event


def init() -> None:
    """Wire up Sentry if a DSN is configured. Safe to call when it is not."""
    dsn = getattr(settings, "sentry_dsn", "") or ""
    if not dsn:
        log.info("sentry not configured; errors go to CloudWatch only")
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:  # pragma: no cover - dependency is pinned
        log.warning("SENTRY_DSN set but sentry-sdk is not installed")
        return

    sentry_sdk.init(
        dsn=dsn,
        environment=getattr(settings, "sentry_environment", "production"),
        release=getattr(settings, "release", None),
        # Performance tracing is sampled hard. Errors are what we need; traces
        # are a nice-to-have that would eat the free quota on their own.
        traces_sample_rate=float(getattr(settings, "sentry_traces_sample_rate", 0.0)),
        # send_default_pii stays FALSE. On it, Sentry attaches the logged-in
        # user, IP and full headers automatically — for us that is restaurant
        # staff identities travelling to a third party.
        send_default_pii=False,
        max_request_body_size="never",
        before_send=_scrub,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
    )
    log.info("sentry active", extra={"code": "DINE-I1001"})


def note_hotel(hotel_id, handle: str | None = None) -> None:
    """Tag the current scope with the tenant.

    An error is only actionable if we know WHOSE it is — "PO export failed" is
    a mystery, "PO export failed for milagu" is a phone call. Uses the handle
    because that is what support can read off the customer's URL.
    """
    dsn = getattr(settings, "sentry_dsn", "") or ""
    if not dsn:
        return
    try:
        import sentry_sdk

        scope = sentry_sdk.get_current_scope()
        if hotel_id is not None:
            scope.set_tag("hotel_id", str(hotel_id))
        if handle:
            scope.set_tag("hotel", handle)
    except Exception:  # pragma: no cover - reporting must never break a request
        pass


def capture(err: BaseException, **tags) -> None:
    """Report a handled exception we still want to know about.

    For the cases we recover from but should not ignore — a Bedrock call that
    failed after retries, a webhook we could not verify. Never raises: telemetry
    must not be able to take down the thing it is watching.
    """
    dsn = getattr(settings, "sentry_dsn", "") or ""
    if not dsn:
        return
    try:
        import sentry_sdk

        scope = sentry_sdk.get_current_scope()
        for key, value in tags.items():
            scope.set_tag(key, str(value))
        sentry_sdk.capture_exception(err)
    except Exception:  # pragma: no cover
        pass
