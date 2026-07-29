"""One log line format, everywhere.

    2026-07-29T09:14:02Z | ERROR | DINE-A3002 | hotel=nirai1 user=owner@x.com
      | req=8f2c | AI allowance spent

Why this shape:

* **Hotel first among the identifiers.** When a restaurant reports a problem you
  search one term — `hotel=nirai1` — and see only their lines. That is the whole
  reason this exists; a log you cannot narrow by tenant is a log you read once
  and give up on.
* **The handle, not the UUID.** `hotel=nirai1` is something support can copy off
  a customer's URL. Nobody has a hotel's UUID to hand mid-call.
* **A code on every failure.** `DINE-A3002` survives rewording; the message does
  not. Searching prose finds the occurrences someone remembered to phrase the
  same way.
* **Pipe-delimited, fixed order.** CloudWatch Logs Insights can `parse` it
  without a JSON round-trip, and a human can still read it.

Context is bound per-request by middleware, so nothing has to remember to pass
the hotel down through five layers of call.
"""
from __future__ import annotations

import logging
import sys
from contextvars import ContextVar

from app.core.errors import UNKNOWN

# Bound per request; empty outside one (startup, migrations, scripts).
_hotel: ContextVar[str] = ContextVar("log_hotel", default="-")
_user: ContextVar[str] = ContextVar("log_user", default="-")
_request: ContextVar[str] = ContextVar("log_request", default="-")


def bind(
    hotel: str | None = None,
    user: str | None = None,
    request_id: str | None = None,
) -> None:
    """Attach identity to every log line for the rest of this request.

    Only the fields passed are changed. This matters because binding happens in
    two places at different times — the request id at the middleware, the hotel
    once auth has resolved it — and a bind that reset everything would silently
    erase the request id when the second call landed.
    """
    if hotel is not None:
        _hotel.set(hotel or "-")
    if user is not None:
        _user.set(user or "-")
    if request_id is not None:
        _request.set(request_id or "-")


def clear() -> None:
    """Reset everything. Called when a request finishes so the next one on this
    worker cannot inherit the last customer's identity."""
    _hotel.set("-")
    _user.set("-")
    _request.set("-")


class DineFormatter(logging.Formatter):
    """timestamp | LEVEL | CODE | hotel/user | req | message"""

    converter = None  # use UTC via formatTime below

    def format(self, record: logging.LogRecord) -> str:
        # A code can be passed explicitly (log.error(..., extra={"code": ...}));
        # anything without one is unclassified, and that is worth seeing.
        code = getattr(record, "code", None)
        if not code:
            code = UNKNOWN if record.levelno >= logging.ERROR else "-"

        ts = self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ")
        line = (
            f"{ts} | {record.levelname} | {code} | "
            f"hotel={_hotel.get()} user={_user.get()} | req={_request.get()} | "
            f"{record.getMessage()}"
        )
        if record.exc_info:
            # Keep the traceback attached to its own line rather than a second
            # unparseable event.
            line += "\n" + self.formatException(record.exc_info)
        return line


def configure(level: str = "INFO") -> None:
    """Install the format on the root logger. Safe to call twice."""
    import time

    logging.Formatter.converter = time.gmtime  # timestamps in UTC, always

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(DineFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # uvicorn ships its own handlers; take them over so every line matches.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
