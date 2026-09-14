#!/usr/bin/env python3
"""Where we are in the current 5-hour Claude window.

    "if it reaches 95% then inform all agents [that] we are nearing token
     limit... whoever is working on any task, try to complete."

WHY THERE IS NO PERCENTAGE HERE

I built one first. It was a lie, and the evidence that it was a lie is the most
useful thing in this file.

The plan was: sum the tokens in the window, divide by a ceiling learned from
past 429s. The tokens are exact — they are the numbers the API returned. The
ceiling is the problem. This account's own history says:

    429 at 08:01 today — that window had reached $41.87
    429 at 14:16 today — that window had reached $74.20

Nearly double, same account, same day. So the limit is not cost, and it is not
a plain token count either: it weights models differently (opus costs far more
against it than sonnet) and none of that weighting is published. "73% used"
built on top of that is a number with a decimal point and no meaning, which is
worse than no number — people plan around decimal points.

WHAT IS ACTUALLY KNOWABLE, AND IS REPORTED

  · The window's real boundaries. `ccusage blocks` models the same 5-hour
    blocks, and its start time matched the reset named in a live 429 exactly.
  · Everything spent so far — tokens by kind, and cost, which already weights
    cache reads by price rather than by a factor I invented.
  · The burn rate, and so what this window is on course to reach.
  · How that compares with the windows where this account has actually been cut
    off. Not a percentage — a position in a distribution, which is what the
    evidence honestly supports.

CHECKED RATHER THAN ASSUMED — things that do not work

  · `~/.claude/stats-cache.json` — does not exist. Widely repeated online; it
    is not on this machine, and nothing else in ~/.claude carries usage.
  · `/usage` — interactive, for a human to read; no stdout to parse.
  · `claude-code-stats` — needs a Rust toolchain, not installed here.
  · Response headers hold the real figure, and neither this session nor a
    subagent can see them.

Needs `npx ccusage` (fetched on demand, nothing to install).

    python scripts/token_budget.py
    python scripts/token_budget.py --json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime

#: Windows where this account was actually cut off, and what they had reached.
#: Measured from real `isApiErrorMessage` 429s naming the 5-HOUR limit — weekly
#: ones are excluded, because a weekly 429 can fire while the 5-hour window is
#: nearly empty and would drag this estimate to a third of its true value.
#:
#: The SPREAD is the finding. Add to it as more are observed; never average it
#: away into a single reassuring figure.
KNOWN_CUTOFFS_USD = [41.87, 74.20]


def ccusage(*args: str) -> dict:
    out = subprocess.run(
        ["npx", "-y", "ccusage@latest", *args, "--json"],
        capture_output=True,
        text=True,
        timeout=300,
        shell=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"ccusage failed: {out.stderr.strip()[:300]}")
    return json.loads(out.stdout)


def active_block() -> dict | None:
    blocks = ccusage("blocks", "--active").get("blocks", [])
    return next((b for b in blocks if b.get("isActive")), None)


def assess(block: dict) -> dict:
    cost = block.get("costUSD", 0.0)
    proj = block.get("projection") or {}
    burn = block.get("burnRate") or {}
    tc = block.get("tokenCounts") or {}

    low, high = min(KNOWN_CUTOFFS_USD), max(KNOWN_CUTOFFS_USD)

    # A BAND, not a percentage. "Past the cheapest window that has ever been cut
    # off" is a claim the evidence supports; "82% used" is not.
    if cost >= high:
        state = "CRITICAL"
        why = (
            f"${cost:.2f} is past the most expensive window that has ever been "
            f"cut off (${high:.2f}). It could stop at any point."
        )
    elif cost >= low:
        state = "WARN"
        why = (
            f"${cost:.2f} is inside the range where this account has been cut "
            f"off before (${low:.2f}–${high:.2f})."
        )
    elif cost >= low * 0.7:
        state = "WATCH"
        why = (
            f"${cost:.2f} is approaching the cheapest window ever cut off "
            f"(${low:.2f})."
        )
    else:
        state = "OK"
        why = f"${cost:.2f}; the earliest cut-off on record was ${low:.2f}."

    projected = proj.get("totalCost")
    if projected and projected >= low and state in ("OK", "WATCH"):
        why += (
            f" At the current rate this window is on course for ${projected:.2f}, "
            f"which would reach it."
        )

    return {
        "as_of": datetime.now(UTC).isoformat(),
        "window_start": block.get("startTime"),
        "window_end": block.get("endTime"),
        "minutes_left": proj.get("remainingMinutes"),
        "cost_usd": round(cost, 2),
        "projected_cost_usd": round(projected, 2) if projected else None,
        "total_tokens": block.get("totalTokens"),
        "input": tc.get("inputTokens"),
        "output": tc.get("outputTokens"),
        "cache_write": tc.get("cacheCreationInputTokens"),
        "cache_read": tc.get("cacheReadInputTokens"),
        "cost_per_hour": round(burn.get("costPerHour", 0), 2),
        "models": block.get("models", []),
        "known_cutoffs_usd": KNOWN_CUTOFFS_USD,
        "state": state,
        "reason": why,
        "caveat": (
            "There is no readable limit. This is a position relative to windows "
            "where this account was actually cut off — not a percentage of a "
            "known allowance. Quote it that way."
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    try:
        block = active_block()
    except Exception as e:  # noqa: BLE001 - a broken gauge must say it is broken
        msg = {"state": "UNKNOWN", "error": str(e)[:300]}
        print(json.dumps(msg, indent=2) if args.json else f"Cannot read usage: {e}")
        return 1

    if block is None:
        msg = {"state": "IDLE", "reason": "No active 5-hour window."}
        print(json.dumps(msg, indent=2) if args.json else "No active window — nothing spent yet.")
        return 0

    r = assess(block)
    if args.json:
        print(json.dumps(r, indent=2))
        return 0

    print(
        f"5-hour window  {r['window_start'][11:16]} -> {r['window_end'][11:16]} UTC"
        f"   ({r['minutes_left']} min left)"
    )
    print(f"  spent          ${r['cost_usd']}")
    print(f"  on course for  ${r['projected_cost_usd']}   (${r['cost_per_hour']}/hr)")
    print(f"  tokens         {r['total_tokens']:,}")
    print(
        f"     output {r['output']:,} | cache write {r['cache_write']:,} "
        f"| cache read {r['cache_read']:,}"
    )
    print(f"  models         {', '.join(r['models'])}")
    print(f"\n  [{r['state']}] {r['reason']}")
    print(f"\n  {r['caveat']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
