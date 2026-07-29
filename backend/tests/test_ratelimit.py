"""Rate limits on the endpoints a stranger can reach.

Unlike an AI overspend, a password-guessing run sends no invoice — you find out
when an account is taken. These tests exist so the limits cannot be removed by
accident.
"""
import pytest
from fastapi import HTTPException

from app.core import ratelimit


class _Req:
    """Minimal stand-in for a Request: the limiter only reads the IP."""

    def __init__(self, ip="1.2.3.4", fwd=None):
        self.headers = {"x-forwarded-for": fwd} if fwd else {}
        self.client = type("c", (), {"host": ip})()


@pytest.fixture(autouse=True)
def _clear():
    ratelimit._hits.clear()
    yield
    ratelimit._hits.clear()


def test_a_burst_of_logins_is_stopped() -> None:
    limit, _ = ratelimit.LIMITS["login"]
    req = _Req()
    for _ in range(limit):
        ratelimit.guard(req, "login", "a@b.com")
    with pytest.raises(HTTPException) as exc:
        ratelimit.guard(req, "login", "a@b.com")
    assert exc.value.status_code == 429


def test_one_attacker_cannot_lock_out_everyone() -> None:
    """Per-IP buckets are per IP. A different machine must be unaffected —
    otherwise the limiter becomes the denial of service."""
    limit, _ = ratelimit.LIMITS["login"]
    for _ in range(limit):
        ratelimit.guard(_Req(ip="9.9.9.9"), "login", "victim@b.com")
    # a different IP, different account: still fine
    ratelimit.guard(_Req(ip="5.5.5.5"), "login", "someone@else.com")


def test_a_distributed_attempt_on_one_account_is_still_caught() -> None:
    """Every request from a fresh IP — invisible to a per-IP limit alone."""
    limit, _ = ratelimit.LIMITS["login"]
    identifier = "target@b.com"
    with pytest.raises(HTTPException):
        for i in range(limit * 2 + 1):
            ratelimit.guard(_Req(ip=f"10.0.0.{i}"), "login", identifier)


def test_the_proxy_header_cannot_be_spoofed_into_a_fresh_bucket() -> None:
    """Caddy appends the IP it saw LAST, so that is the one we trust. Reading
    the first entry would let a client mint a new bucket per request."""
    limit, _ = ratelimit.LIMITS["login"]
    for _ in range(limit):
        # client claims a different origin each time; the real one is last
        ratelimit.guard(_Req(fwd="1.1.1.1, 203.0.113.7"), "login", "x@y.com")
    with pytest.raises(HTTPException):
        ratelimit.guard(_Req(fwd="2.2.2.2, 203.0.113.7"), "login", "x@y.com")


def test_email_sending_endpoints_are_limited() -> None:
    """Unmetered, these are a way to use us to flood someone else's inbox."""
    for action in ("forgot_password", "resend_verification", "register"):
        assert action in ratelimit.LIMITS
        limit, window = ratelimit.LIMITS[action]
        assert limit <= 10 and window >= 300, action
