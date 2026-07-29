"""What must never leave the box.

These are not tests of Sentry — they are tests of the filter in front of it.
Every assertion here corresponds to a way a regression would ship somebody's
restaurant data to a third party, or drown the alert channel so we stop reading
it. Both failures are silent.
"""
from app.core import monitoring


class _Refused(Exception):
    """Stands in for HTTPException — only status_code matters to the filter."""

    def __init__(self, status_code: int) -> None:
        super().__init__(str(status_code))
        self.status_code = status_code


def _hint(exc: Exception) -> dict:
    return {"exc_info": (type(exc), exc, None)}


def test_credentials_never_leave_the_instance() -> None:
    """A bearer token in a report is a token in a third party's database."""
    event = {
        "request": {
            "headers": {
                "Authorization": "Bearer real-token",
                "X-Api-Key": "sk-live-123",
                "Cookie": "session=abc",
                "Accept": "application/json",
                "User-Agent": "Safari",
            }
        }
    }
    out = monitoring._scrub(event, {})
    headers = out["request"]["headers"]
    assert headers["Authorization"] == "[scrubbed]"
    assert headers["X-Api-Key"] == "[scrubbed]"
    assert headers["Cookie"] == "[scrubbed]"
    # Harmless diagnostics survive — over-scrubbing makes reports useless.
    assert headers["Accept"] == "application/json"
    assert headers["User-Agent"] == "Safari"


def test_request_bodies_are_dropped_entirely() -> None:
    """A body can be a payroll run, a supplier price list, or an AI prompt
    quoting either. The URL tells us where it broke; the body is not worth it."""
    event = {"request": {"data": {"password": "hunter2", "gross_pay": 2400}}}
    assert "data" not in monitoring._scrub(event, {})["request"]


def test_expected_refusals_are_not_reported() -> None:
    """These mean the app worked. Reporting them burns the free tier in a day
    and trains us to ignore the alerts — worse than having no alerts."""
    for status in (400, 401, 402, 403, 404, 409, 422, 429):
        assert monitoring._scrub({}, _hint(_Refused(status))) is None, status


def test_real_failures_still_get_through() -> None:
    """The other half of the filter: it must not be so eager that nothing is
    ever reported. A 500 and a bare exception are exactly what we want to see."""
    assert monitoring._scrub({}, _hint(_Refused(500))) is not None
    assert monitoring._scrub({}, _hint(ValueError("boom"))) is not None


def test_everything_is_a_no_op_without_a_dsn(monkeypatch) -> None:
    """Dev, CI and any deploy without the env var must make no network calls and
    must not raise. Telemetry may never break the thing it is watching."""
    monkeypatch.setattr(monitoring.settings, "sentry_dsn", "", raising=False)
    monitoring.init()
    monitoring.note_hotel("some-id", "milagu")
    monitoring.capture(ValueError("ignored"), where="test")


def test_reporting_failures_are_swallowed(monkeypatch) -> None:
    """If Sentry itself is broken or unreachable, the request must still finish.
    Simulated by pointing at a DSN while making the SDK import/call explode."""
    monkeypatch.setattr(monitoring.settings, "sentry_dsn", "https://x@example/1", raising=False)
    import builtins

    real_import = builtins.__import__

    def _boom(name, *a, **k):
        if name.startswith("sentry_sdk"):
            raise RuntimeError("sentry is down")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", _boom)
    # Neither of these may raise.
    monitoring.note_hotel("h", "milagu")
    monitoring.capture(ValueError("boom"))
