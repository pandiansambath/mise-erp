#!/usr/bin/env python3
"""🎙️ The voice's own test bench.

    "create your own voice testing agent and test the voice AI please"

He is right that ad-hoc probes were not finding these. Every fault in this
feature has been one of five things, and none of them raise an exception — they
all come back 200 OK with something wrong inside:

  * it never answered (burned its laps on a failing tool)
  * it answered but did nothing (no action for an instruction)
  * it talked for thirty seconds
  * the audio never arrived, or arrived long after the text
  * it said it had done something it had not

So this asks the real questions against the real deployment and reports on those
five, per question. Run it after any change to the voice:

    python scripts/voice_check.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

BASE = os.environ.get("DINEAI_BASE", "https://nirai1.dineai.cloud")
EMAIL = os.environ.get("DINEAI_EMAIL", "superadmin@gmail.com")
PASSWORD = os.environ.get("DINEAI_PASSWORD", "superadmin@123")

#: (what he says, what must happen). `action` means the page has to move.
CASES: list[tuple[str, dict]] = [
    ("what did we take today", {"answers": True}),
    ("what's running low", {"answers": True}),
    ("how are we doing", {"answers": True}),
    ("is there a rota for Balaji today", {"answers": True, "no_tool_thrash": True}),
    ("check the rota for tomorrow", {"answers": True, "no_tool_thrash": True}),
    ("show me the staff list", {"answers": True}),
    ("open expenses", {"answers": True, "action": "navigate"}),
    ("take me to the money page", {"answers": True, "action": "navigate"}),
    ("add a 120 pound cash sale into the sales page", {"answers": True, "action": "fill"}),
    ("log a 40 pound gas bill in expenses", {"answers": True, "action": "fill"}),
    # The one that used to produce a thirty-second lecture about security.
    ("show me the money pin", {"answers": True, "no_lecture": True}),
]

FALLBACK = "got tangled up"
LECTURE = ("security", "violation", "risk", "not permitted", "unable to")


def login() -> str:
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=json.dumps({"email": EMAIL, "password": PASSWORD}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    return d.get("access_token") or d.get("token") or ""


def one_turn(token: str, text: str) -> dict:
    req = urllib.request.Request(
        f"{BASE}/api/assistant/voice/stream",
        data=json.dumps(
            {"text": text, "history": [], "route": "/dashboard", "voice": "Amy"}
        ).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    t0 = time.monotonic()
    reply = ""
    actions: list[str] = []
    tools: list[str] = []
    first_text = first_audio = last_text = None
    chunks = 0
    with urllib.request.urlopen(req, timeout=120) as r:
        buf = b""
        for raw in r:
            buf += raw
            while b"\n\n" in buf:
                frame, buf = buf.split(b"\n\n", 1)
                line = next((x for x in frame.split(b"\n") if x.startswith(b"data:")), None)
                if not line:
                    continue
                ev = json.loads(line[5:].decode())
                el = time.monotonic() - t0
                kind = ev.get("type")
                if kind in ("draft", "delta"):
                    if first_text is None:
                        first_text = el
                    last_text = el
                    reply += ev.get("text", "")
                elif kind == "audio":
                    chunks += 1
                    if first_audio is None:
                        first_audio = el
                elif kind == "action":
                    actions.append(ev["action"]["kind"])
                elif kind == "doing":
                    tools.append(ev.get("label", ""))
    return {
        "reply": reply,
        "actions": actions,
        "tools": tools,
        "words": len(reply.split()),
        "first_text": first_text,
        "first_audio": first_audio,
        "last_text": last_text,
        "chunks": chunks,
        "total": time.monotonic() - t0,
    }


def main() -> int:
    token = login()
    if not token:
        print("could not sign in")
        return 2

    failures: list[str] = []
    print(f"{'question':46} {'words':>5} {'text':>6} {'sound':>6} {'gap':>6}  verdict")
    print("-" * 100)

    for text, expect in CASES:
        try:
            r = one_turn(token, text)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{text!r}: request failed — {exc}")
            print(f"{text[:45]:46} {'—':>5} {'—':>6} {'—':>6} {'—':>6}  REQUEST FAILED")
            continue

        problems = []
        if expect.get("answers") and (not r["reply"].strip() or FALLBACK in r["reply"].lower()):
            problems.append("no real answer")
        if expect.get("action") and expect["action"] not in r["actions"]:
            problems.append(f"no {expect['action']} action")
        if r["words"] > 60:
            problems.append(f"{r['words']} words")
        if not r["chunks"]:
            problems.append("no audio")
        if expect.get("no_lecture") and any(w in r["reply"].lower() for w in LECTURE):
            problems.append("lectured")
        if expect.get("no_tool_thrash") and len(r["tools"]) > 3:
            problems.append(f"{len(r['tools'])} lookups")

        gap = (
            r["first_audio"] - r["last_text"]
            if r["first_audio"] and r["last_text"]
            else None
        )
        fmt = lambda v: f"{v:.2f}" if isinstance(v, float) else "—"  # noqa: E731
        verdict = "ok" if not problems else "; ".join(problems)
        print(
            f"{text[:45]:46} {r['words']:>5} {fmt(r['first_text']):>6} "
            f"{fmt(r['first_audio']):>6} {fmt(gap):>6}  {verdict}"
        )
        if problems:
            failures.append(f"{text!r}: {'; '.join(problems)}  ->  {r['reply'][:110]}")

    print()
    if failures:
        print(f"{len(failures)} of {len(CASES)} need attention:\n")
        for f in failures:
            print(f"  • {f}")
        return 1
    print(f"all {len(CASES)} good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
