#!/usr/bin/env python3
"""How much of the rolling 5-hour Claude budget is spent.

    "there is 2 limit, one is 5hr limit another one is weekly limit. You check
     5hr limit. If it reaches 95% then inform all agents [that] we are nearing
     token limit."

WHY THIS READS TRANSCRIPTS RATHER THAN ASKING

There is no API, file or command that reports the remaining allowance. The real
number arrives in HTTP response headers that neither the main session nor a
subagent can see, and the only other signal is the 429 itself — which is the
moment it is already too late to land safely.

What IS on disk is every request's token usage with a timestamp, in the session
transcripts under ~/.claude/projects/*/. Summing the last five hours of those
is a measurement of the same thing the limiter is counting.

WHAT IS HONEST ABOUT THIS, AND WHAT IS NOT

Honest: the token counts are exact, they are the numbers the API itself
returned, and the five-hour window is the real window.

Not exact: the CEILING. Nobody publishes it, it varies by plan, and cache reads
almost certainly do not count the same as fresh input. So the percentage is
only as good as the ceiling it is measured against — which is why `--calibrate`
exists. It finds the moments this account actually hit a 429 and reports what
the five-hour total was at each, so the ceiling is learned from this account's
own history rather than assumed.

Until it has been calibrated at least once, treat the percentage as a direction
of travel, not a guarantee. Say so when reporting it.

Usage:
    python scripts/token_budget.py                 # where we are now
    python scripts/token_budget.py --calibrate     # learn the ceiling from past 429s
    python scripts/token_budget.py --json          # for an agent to parse
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
from datetime import UTC, datetime, timedelta

PROJECTS = pathlib.Path.home() / ".claude" / "projects"
CALIBRATION = pathlib.Path(__file__).resolve().parent.parent / "docs" / "token_ceiling.json"
WINDOW = timedelta(hours=5)

#: Read this much from the end of each transcript before giving up on finding
#: older-than-window lines. Transcripts reach 800 MB, so reading whole files is
#: not an option — and everything we want is at the end.
TAIL_BYTES = 120 * 1024 * 1024


def _tail_lines(path: pathlib.Path, budget: int = TAIL_BYTES):
    """Yield lines from the END of a file backwards, newest first."""
    size = path.stat().st_size
    start = max(0, size - budget)
    with path.open("rb") as fh:
        fh.seek(start)
        if start:
            fh.readline()  # discard the partial line we landed in
        chunk = fh.read()
    for raw in reversed(chunk.split(b"\n")):
        if raw.strip():
            yield raw


def _when(d: dict) -> datetime | None:
    for key in ("timestamp", "client_timestamp"):
        v = d.get(key)
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00"))
            except ValueError:
                pass
    return None


def collect(since: datetime, until: datetime | None = None) -> dict:
    """Every token recorded between `since` and `until`, across all projects.

    `until` is not optional decoration. Without it, calibrating against a 429
    from six days ago summed every token from then until NOW — so the older the
    sample, the bigger it looked, and the "ceiling" rose monotonically with age
    (21M for today's, 110M for one from six days back). A five-fold spread that
    was pure measurement error.
    """
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    requests = 0
    oldest_seen = None
    files = sorted(PROJECTS.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)

    for path in files:
        # A transcript last written before the window opened cannot contain
        # anything inside it.
        if datetime.fromtimestamp(path.stat().st_mtime, UTC) < since:
            continue
        stale = 0
        for raw in _tail_lines(path):
            try:
                d = json.loads(raw)
            except Exception:
                continue
            ts = _when(d)
            if ts is None:
                continue
            if until is not None and ts > until:
                continue
            if ts < since:
                # Lines are broadly chronological; a run of old ones means we
                # have walked back past the window in this file.
                stale += 1
                if stale > 400:
                    break
                continue
            stale = 0
            usage = (d.get("message") or {}).get("usage")
            if not isinstance(usage, dict):
                continue
            requests += 1
            if oldest_seen is None or ts < oldest_seen:
                oldest_seen = ts
            for k in totals:
                v = usage.get(k)
                if isinstance(v, int):
                    totals[k] += v

    totals["requests"] = requests
    totals["oldest_in_window"] = oldest_seen.isoformat() if oldest_seen else None
    # Cache reads are an order of magnitude cheaper than fresh input, so a raw
    # sum wildly overstates pressure on a session like this one, which re-reads
    # a huge cached context every turn. Weighted at a tenth — the published
    # price ratio — and reported alongside the raw figure so nobody has to
    # trust the weighting blind.
    totals["weighted"] = (
        totals["input_tokens"]
        + totals["output_tokens"]
        + totals["cache_creation_input_tokens"]
        + totals["cache_read_input_tokens"] // 10
    )
    totals["raw"] = (
        totals["input_tokens"]
        + totals["output_tokens"]
        + totals["cache_creation_input_tokens"]
        + totals["cache_read_input_tokens"]
    )
    return totals


def load_ceiling() -> dict | None:
    if CALIBRATION.exists():
        try:
            return json.loads(CALIBRATION.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def calibrate() -> dict:
    """Find real 5-hour 429s and record what the window total was at each.

    TWO THINGS THE FIRST VERSION GOT WRONG, both caught by running it.

    1. IT MATCHED MY OWN PROSE. The regex looked for "session limit" anywhere
       in a line, which hits the notification text, the queued user message,
       and every sentence I have written ABOUT rate limits. 15 genuine errors,
       33 false positives. A real API failure is marked
       `isApiErrorMessage: true` on an assistant record — that is the only
       thing worth matching.

    2. IT MIXED UP THE TWO LIMITS. There is a 5-hour limit and a weekly one,
       and they produce different messages ("session limit · resets 4:10pm"
       versus "weekly limit · resets Sep 14, 3:30am"). A weekly 429 can fire
       when the 5-hour window is nearly empty, so including those dragged the
       learned ceiling down to a third of its real value — which is how the
       tool came to report 100% two minutes after a reset.

    The median is used rather than the minimum. Samples vary with the mix of
    models and how much of the context was cached, and the lowest sample is the
    most likely to be an artefact rather than the true wall.
    """
    hits: list[dict] = []
    files = sorted(PROJECTS.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in files[:6]:
        for raw in _tail_lines(path):
            if b"session limit" not in raw:
                continue
            # The WEEKLY limit is a different wall; its 429 says nothing useful
            # about the 5-hour window.
            if b"weekly limit" in raw:
                continue
            try:
                d = json.loads(raw)
            except Exception:
                continue
            # Only a genuine API failure, not a mention of one.
            if d.get("isApiErrorMessage") is not True:
                continue
            ts = _when(d)
            if ts is None:
                continue
            if any(abs((ts - h["at_dt"]).total_seconds()) < 1800 for h in hits):
                continue  # one incident, several retries
            spend = collect(ts - WINDOW, until=ts)
            hits.append(
                {
                    "at_dt": ts,
                    "at": ts.isoformat(),
                    "weighted": spend["weighted"],
                    "raw": spend["raw"],
                    "requests": spend["requests"],
                }
            )
            if len(hits) >= 8:
                break
        if len(hits) >= 8:
            break

    for h in hits:
        h.pop("at_dt", None)
    weights = sorted(h["weighted"] for h in hits)
    median = weights[len(weights) // 2] if weights else None
    out = {
        "samples": hits,
        "ceiling_weighted": median,
        "spread": [weights[0], weights[-1]] if weights else None,
        "sample_count": len(hits),
        "calibrated_at": datetime.now(UTC).isoformat(),
        "note": (
            "Learned from this account's own 5-hour 429s only — weekly-limit "
            "errors excluded, and only records marked isApiErrorMessage. The "
            "MEDIAN is used: the lowest sample is more often an artefact than "
            "the real wall. Treat the percentage as a guide, not a guarantee."
        ),
    }
    CALIBRATION.parent.mkdir(parents=True, exist_ok=True)
    CALIBRATION.write_text(json.dumps(out, indent=2), encoding="utf-8")
    return out


def last_reset() -> datetime | None:
    """When the 5-hour window most recently started.

    The limit does not slide — it resets at a stated time ("resets 9pm"), and
    everything before that no longer counts. A plain rolling five-hour sum
    therefore OVER-counts right after a reset, which is exactly how this tool
    first reported 100% used two minutes after the limit had cleared.

    Read from the newest genuine 429: if it names a reset time that has since
    passed, the window began there.
    """
    files = sorted(PROJECTS.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    now = datetime.now(UTC)
    for path in files[:3]:
        for raw in _tail_lines(path, budget=40 * 1024 * 1024):
            if b"session limit" not in raw or b"weekly limit" in raw:
                continue
            try:
                d = json.loads(raw)
            except Exception:
                continue
            if d.get("isApiErrorMessage") is not True:
                continue
            ts = _when(d)
            if ts is None:
                continue
            # "resets 9pm (Asia/Kolkata)" / "resets 4:10pm"
            m = re.search(rb"resets\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)", raw, re.I)
            if not m:
                return ts
            hour = int(m.group(1)) % 12
            minute = int(m.group(2) or 0)
            if m.group(3).lower() == b"pm":
                hour += 12
            # The stated time is in the user's zone; the error itself gives us
            # the UTC anchor, so search forward from it for that wall clock.
            for add in range(0, 24):
                cand = (ts + timedelta(hours=add)).replace(minute=minute, second=0, microsecond=0)
                for off in (5.5, 0):  # Asia/Kolkata, then UTC
                    want = (hour - off) % 24
                    if cand.hour == int(want) and cand > ts:
                        if cand <= now:
                            return cand
            return ts
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.calibrate:
        out = calibrate()
        print(json.dumps(out, indent=2))
        return 0

    now = datetime.now(UTC)
    # Count from the last RESET when we know it, not from five hours ago.
    reset = last_reset()
    window_start = now - WINDOW
    if reset and reset > window_start:
        window_start = reset
    spend = collect(window_start)
    cal = load_ceiling()
    ceiling = (cal or {}).get("ceiling_weighted")

    pct = round(100 * spend["weighted"] / ceiling, 1) if ceiling else None
    result = {
        "window_hours": 5,
        "as_of": now.isoformat(),
        "counting_since": window_start.isoformat(),
        "since_last_reset": bool(reset and reset > now - WINDOW),
        "requests": spend["requests"],
        "weighted_tokens": spend["weighted"],
        "raw_tokens": spend["raw"],
        "input": spend["input_tokens"],
        "output": spend["output_tokens"],
        "cache_write": spend["cache_creation_input_tokens"],
        "cache_read": spend["cache_read_input_tokens"],
        "ceiling_weighted": ceiling,
        "percent_used": pct,
        "calibrated": bool(ceiling),
        "state": (
            "UNCALIBRATED"
            if pct is None
            else "CRITICAL"
            if pct >= 95
            else "WARN"
            if pct >= 80
            else "OK"
        ),
    }

    if args.json:
        print(json.dumps(result, indent=2))
        return 0

    label = "since the last reset" if (reset and reset > now - WINDOW) else "rolling 5 hours"
    print(f"Window: {label}, from {window_start:%H:%M} to {now:%H:%M} UTC")
    print(f"  requests       {spend['requests']:,}")
    print(f"  input          {spend['input_tokens']:,}")
    print(f"  output         {spend['output_tokens']:,}")
    print(f"  cache write    {spend['cache_creation_input_tokens']:,}")
    print(f"  cache read     {spend['cache_read_input_tokens']:,}  (counted at 1/10)")
    print(f"  weighted total {spend['weighted']:,}")
    if ceiling:
        spread = cal.get("spread")
        print(f"\n  ceiling        {ceiling:,}  (median of {cal.get('sample_count', 0)} real 5-hour 429s)")
        if spread:
            print(f"  observed range {spread[0]:,} .. {spread[1]:,} — the percentage is a guide")
        print(f"  USED           {pct}%   [{result['state']}]")
    else:
        print("\n  ceiling        not calibrated — run --calibrate")
        print("  Report this as a direction of travel, not a percentage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
