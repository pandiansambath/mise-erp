"""Rate limiting for the endpoints that let a stranger in.

The AI has spend caps; login and signup had nothing. Password guessing, signup
spam and reset-email flooding were all unmetered — and unlike an AI overspend,
you don't get an invoice telling you it happened.

Deliberately in-process, not Redis. One box, one container: a dict with a
sliding window is honest about what it protects and adds no dependency to
maintain. If this ever runs on more than one instance, this file is the one to
replace — and it says so rather than pretending to be distributed.

Two windows on purpose:

* **Per IP** — stops one machine walking a password list.
* **Per identifier (email)** — stops a distributed attempt on ONE account, which
  an IP limit alone never sees.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.core.errors import AUTH_INVALID_CREDENTIALS

log = logging.getLogger("mise.ratelimit")

# endpoint -> (max attempts, window seconds)
LIMITS: dict[str, tuple[int, int]] = {
    # 20/5min per IP: a restaurant is often behind ONE office NAT address, so a
    # tight cap would lock out a whole shift at open. Still nowhere near enough
    # to walk a password list, and the per-account window below is the one that
    # actually protects a specific login.
    "login": (20, 300),
    # Signup is where spam and card-testing arrive.
    "register": (5, 3600),
    # Each of these sends an EMAIL. Unmetered, they are a way to use us to
    # harass someone else's inbox.
    "forgot_password": (5, 3600),
    "resend_verification": (5, 3600),
    "login_otp": (20, 300),
}

_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    """The caller's IP, trusting the proxy header we actually sit behind.

    Caddy sets X-Forwarded-For; the LAST entry it appends is the one it saw, so
    a client cannot spoof its way into a fresh bucket by sending its own header.
    """
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _check(key: str, limit: int, window: int) -> int:
    """Record a hit; return how many remain. Raises when the bucket is full."""
    now = time.monotonic()
    bucket = _hits[key]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many attempts. Please wait a few minutes and try again.",
        )
    bucket.append(now)
    return limit - len(bucket)


def guard(request: Request, action: str, identifier: str = "") -> None:
    """Rate-limit one attempt, by IP and (when known) by who it targets."""
    limit, window = LIMITS.get(action, (20, 300))

    _check(f"{action}:ip:{_client_ip(request)}", limit, window)
    if identifier:
        # A per-account window catches a distributed attempt on one login, which
        # a per-IP limit cannot see at all.
        _check(f"{action}:id:{identifier.strip().lower()}", limit * 2, window)


def note_failure(action: str, identifier: str) -> None:
    """Log a rejected attempt with a code, so CloudWatch can count them.

    A single failure is someone fat-fingering a password. A hundred against one
    address is the thing you want to be able to search for.
    """
    log.info(
        "auth attempt rejected (%s) for %s",
        action,
        (identifier or "-")[:120],
        extra={"code": AUTH_INVALID_CREDENTIALS},
    )
