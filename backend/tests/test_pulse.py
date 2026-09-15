"""The health page's arithmetic, checked where it is cheap to check.

This exists because every number on `/control-room/health` is computed here and
nowhere else, and an observability page that lies is worse than no page at all —
it is the screen you look at to decide whether to panic.

No database, no app, no network. Milliseconds.
"""

from __future__ import annotations

import time

from app.core import pulse as pulse_mod


def _fresh():
    p = pulse_mod._Pulse()
    return p


def test_empty_says_nothing_rather_than_zero():
    """A quiet box has NO error rate. It does not have a 0% error rate.

    The difference matters on the screen: 0% is a reassurance, and reassurance
    drawn from no data is exactly the failure mode an observability page must
    not have.
    """
    s = _fresh().snapshot()
    assert s["requests"] == 0
    assert s["error_rate"] is None
    assert s["p95_ms"] is None
    assert s["slowest"] == []


def test_error_rate_counts_only_5xx():
    """4xx is usually somebody mistyping a password. 5xx is ours."""
    p = _fresh()
    for _ in range(90):
        p.record("/api/ok", 200, 10)
    for _ in range(5):
        p.record("/api/nope", 404, 10)
    for _ in range(5):
        p.record("/api/boom", 500, 10)

    s = p.snapshot()
    assert s["requests"] == 100
    assert s["error_rate"] == 5.0
    assert s["client_error_rate"] == 5.0
    assert s["by_status"] == {"2xx": 90, "4xx": 5, "5xx": 5}


def test_percentiles_are_real_measurements():
    """Nearest-rank, so p95 is a latency somebody actually experienced.

    A linear interpolation can land between two samples and report a number
    that never happened, which is a strange thing to show on a page whose job
    is to say what happened.
    """
    p = _fresh()
    for ms in range(1, 101):
        p.record("/api/x", 200, ms)
    s = p.snapshot()
    assert s["p50_ms"] in (50, 51)
    assert s["p95_ms"] in (95, 96)
    assert s["p99_ms"] in (99, 100)
    assert s["p95_ms"] in range(1, 101)


def test_slowest_ranks_by_average_not_by_worst_case():
    """One cold start must not convict an endpoint that is fine 400 times."""
    p = _fresh()
    for _ in range(400):
        p.record("/api/fast", 200, 20)
    p.record("/api/fast", 200, 9000)  # one cold start
    for _ in range(20):
        p.record("/api/genuinely-slow", 200, 1200)

    top = p.snapshot()["slowest"][0]
    assert top["path"] == "/api/genuinely-slow"
    assert top["avg_ms"] == 1200


def test_the_window_excludes_older_events():
    p = _fresh()
    p.record("/api/old", 200, 10)
    # reach in and age it rather than sleeping: a test that sleeps an hour is
    # a test nobody runs.
    ts, path, status, ms = p._events[0]
    p._events[0] = (ts - 7200, path, status, ms)
    p.record("/api/new", 200, 10)

    assert p.snapshot(window_s=3600)["requests"] == 1
    assert p.snapshot(window_s=86400)["requests"] == 2


def test_it_cannot_grow_without_bound():
    """A ring buffer on the hot path of every request must stay a fixed size."""
    p = _fresh()
    for i in range(pulse_mod.CAPACITY + 500):
        p.record("/api/x", 200, i)
    assert len(p._events) == pulse_mod.CAPACITY


def test_scope_is_always_stated():
    """The page shows this verbatim. It must never read as fleet-wide."""
    for p in (_fresh(), _fresh()):
        p.record("/api/x", 200, 1)
        assert p.snapshot()["scope"] == "this container, since it started"


def test_uptime_starts_at_creation_not_at_first_request():
    p = _fresh()
    p.started_at = time.time() - 3600
    assert p.snapshot()["uptime_seconds"] >= 3600
