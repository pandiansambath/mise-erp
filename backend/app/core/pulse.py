"""What this box is actually doing, right now.

    "we need observability feature too, like monitoring dashboard for entire
     project — I don't know how to say but yeah we need."

The Control Room already had AI and tenant observability: spend, calls,
latency, failure rate. It had NOTHING about the software: no uptime, no HTTP
error rate, no slow endpoints, no idea what version was running. The page said
so in its own copy and pointed at the AWS console — which is not a monitoring
dashboard for the project, it is an instruction to go and log into something
else.

WHY A RING BUFFER AND NOT A TABLE

Every request already produces an access line — `GET /api/x -> 200 in 12ms` —
written by the middleware in `main.py`. That is exactly the raw material, and
it is already going to CloudWatch. Reading it back per page load would mean a
CloudWatch Logs Insights query, which needs IAM the app does not have, takes
seconds, and is billed per gigabyte scanned.

Writing a row per request to Postgres instead would put a write on the hot path
of every read — on a db.t4g.micro that is a bad trade for a screen one person
opens occasionally.

So: a fixed-size deque in memory. No allocation after start-up, no I/O, no
lock contention worth measuring, and it costs one append per request. The
honest limits, stated here and on the screen rather than hidden:

  · it is THIS container. One box, one process, so that is the whole app today
    — but it is not a fleet-wide figure and must not be presented as one.
  · it resets on deploy. That is a feature as much as a limit: "since this
    version started" is the window you actually want when asking whether the
    thing you just shipped is healthy.
  · it holds the last N requests, not all time. Long-range history is what
    CloudWatch is for, and that stays true.
"""

from __future__ import annotations

import os
import threading
import time
from collections import Counter, deque
from datetime import UTC, datetime

#: Roughly an hour of this app's traffic, and about 1 MB of memory. Sized to be
#: boring rather than tuned.
CAPACITY = 5000

#: Slower than this and we want to see it by name.
SLOW_MS = 800


class _Pulse:
    """Thread-safe because Starlette may run middleware on several threads."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: deque[tuple[float, str, int, int]] = deque(maxlen=CAPACITY)
        self.started_at = time.time()

    def record(self, path: str, status: int, ms: int) -> None:
        with self._lock:
            self._events.append((time.time(), path, status, ms))

    def snapshot(self, window_s: int = 3600) -> dict:
        now = time.time()
        with self._lock:
            events = [e for e in self._events if now - e[0] <= window_s]

        total = len(events)
        uptime_s = int(now - self.started_at)
        base = {
            "uptime_seconds": uptime_s,
            "started_at": datetime.fromtimestamp(self.started_at, UTC).isoformat(),
            # APP_COMMIT is the name that actually exists: the Dockerfile takes
            # it as a build arg and the deploy passes ${{ github.sha }} into it.
            # I first wrote GIT_SHA/IMAGE_TAG — neither is set anywhere — and the
            # live endpoint duly returned "unknown". Read the signature.
            "version": os.getenv("APP_COMMIT")
            or os.getenv("GIT_SHA")
            or "unknown",
            "window_seconds": window_s,
            "capacity": CAPACITY,
            "requests": total,
            # Said out loud so nobody reads this as a fleet-wide number.
            "scope": "this container, since it started",
        }
        if not total:
            return {**base, "error_rate": None, "p50_ms": None, "p95_ms": None,
                    "p99_ms": None, "slowest": [], "by_status": {}, "per_minute": []}

        times = sorted(e[3] for e in events)

        def pct(p: float) -> int:
            # Nearest-rank. With a few thousand samples the difference from a
            # linear interpolation is noise, and this cannot land between two
            # real measurements and report a latency nobody experienced.
            return times[min(len(times) - 1, int(len(times) * p))]

        server_errors = sum(1 for e in events if e[2] >= 500)
        client_errors = sum(1 for e in events if 400 <= e[2] < 500)

        # Slowest by AVERAGE, not by worst case: one cold start should not
        # convict an endpoint that is fine the other four hundred times.
        agg: dict[str, list[int]] = {}
        for _, path, _, ms in events:
            agg.setdefault(path, []).append(ms)
        slowest = sorted(
            (
                {
                    "path": p,
                    "calls": len(v),
                    "avg_ms": round(sum(v) / len(v)),
                    "max_ms": max(v),
                }
                for p, v in agg.items()
            ),
            key=lambda r: r["avg_ms"],
            reverse=True,
        )[:8]

        per_minute: Counter[int] = Counter()
        errors_per_minute: Counter[int] = Counter()
        for ts, _, status, _ in events:
            minute = int((now - ts) // 60)
            per_minute[minute] += 1
            if status >= 500:
                errors_per_minute[minute] += 1
        span = min(60, max(per_minute) + 1 if per_minute else 1)

        return {
            **base,
            "error_rate": round(server_errors / total * 100, 2),
            "client_error_rate": round(client_errors / total * 100, 2),
            "server_errors": server_errors,
            "client_errors": client_errors,
            "p50_ms": pct(0.50),
            "p95_ms": pct(0.95),
            "p99_ms": pct(0.99),
            "slow_calls": sum(1 for e in events if e[3] >= SLOW_MS),
            "slow_threshold_ms": SLOW_MS,
            "slowest": slowest,
            "by_status": dict(Counter(f"{e[2] // 100}xx" for e in events)),
            # Oldest minute first, so it reads left to right like a chart.
            "per_minute": [
                {"minutes_ago": m, "requests": per_minute.get(m, 0),
                 "errors": errors_per_minute.get(m, 0)}
                for m in range(span - 1, -1, -1)
            ],
        }


PULSE = _Pulse()
