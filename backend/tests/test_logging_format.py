"""The log line must actually come out.

This exists because it once did not. `DineFormatter` set `converter = None`,
which shadowed the base class's `time.gmtime`, so `formatTime()` called
`None(record.created)` and every single record raised TypeError. Python's
logging then swallowed it and printed "--- Logging error ---" plus a traceback
to stderr instead of the log line.

It ran that way in production unnoticed, and it was invisible precisely because
the thing that would have reported the problem was the broken part. Structured
logging is only worth having if it emits, so these assert it emits.
"""
import logging
from io import StringIO

from app.core import logging_setup


def _capture(**bind) -> StringIO:
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(logging_setup.DineFormatter())
    log = logging.getLogger("mise.test.format")
    log.handlers = [handler]
    log.setLevel(logging.DEBUG)
    log.propagate = False
    logging_setup.clear()
    if bind:
        logging_setup.bind(**bind)
    return buf, log  # type: ignore[return-value]


def test_a_log_line_is_actually_produced() -> None:
    """The regression itself: no output at all is the failure mode."""
    buf, log = _capture()
    log.info("hello")
    out = buf.getvalue()
    assert "hello" in out
    assert "Logging error" not in out, "the formatter is raising again"


def test_the_line_carries_the_agreed_fields() -> None:
    """timestamp | LEVEL | CODE | hotel/user | req | message — the format that
    makes a customer's trouble findable by grepping one term."""
    buf, log = _capture(hotel="milagu", user="owner@x.com", request_id="abc123")
    log.error("something broke", extra={"code": "DINE-A3002"})
    out = buf.getvalue()
    assert "ERROR" in out
    assert "DINE-A3002" in out
    assert "hotel=milagu" in out
    assert "user=owner@x.com" in out
    assert "req=abc123" in out
    assert out.startswith("20") and "T" in out and "Z" in out, "expected a UTC ISO timestamp"


def test_an_unclassified_error_still_gets_a_code() -> None:
    """An error without an explicit code must not log a bare '-' — unclassified
    errors are exactly the ones worth finding later."""
    buf, log = _capture()
    log.error("no code given")
    assert "DINE-" in buf.getvalue()


def test_tracebacks_stay_attached() -> None:
    """A traceback split into its own event is unreadable in CloudWatch."""
    buf, log = _capture()
    try:
        raise ValueError("boom")
    except ValueError:
        log.exception("with traceback")
    out = buf.getvalue()
    assert "Traceback" in out and "ValueError: boom" in out


def test_identity_does_not_leak_between_requests() -> None:
    """clear() runs when a request finishes; the next one on the same worker
    must not inherit the last customer's hotel."""
    buf, log = _capture(hotel="milagu", user="owner@x.com")
    logging_setup.clear()
    log.info("after clear")
    out = buf.getvalue()
    assert "hotel=-" in out and "milagu" not in out
