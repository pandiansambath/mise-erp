#!/usr/bin/env python3
"""Fetch HD landing-journey clips from Pexels (sharper than the Pixabay tier).

Peaceful arc: mountains → sea → forest → produce → cooking → dining → sharing →
sunrise. For each scene we pick an HD video file ~1280px wide (sharp but not a
multi-GB 4K), download it + its poster into frontend/public/journey/.

Key is read at runtime from the gitignored docs file. Run:
    python scripts/fetch_journey_pexels.py [scene…]
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY_FILE = ROOT / "docs" / "pexels_api_key_and_documentation_link.txt"
OUT = ROOT / "frontend" / "public" / "journey"

SCENES: list[tuple[str, list[str]]] = [
    ("mountains", ["drone flying over mountain peaks", "aerial snow mountains sunrise", "epic mountain range drone"]),
    ("sea", ["turquoise ocean aerial", "blue sea waves aerial", "tropical ocean drone"]),
    ("forest", ["aerial forest sunlight", "green forest trees", "sunlight through forest"]),
    ("produce", ["fresh vegetables wooden table", "organic vegetables close up", "colourful fresh vegetables"]),
    ("cooking", ["chef cooking restaurant kitchen", "chef plating food", "flames cooking pan"]),
    ("dining", ["fine dining restaurant interior", "cozy restaurant evening", "restaurant table candle"]),
    ("sharing", ["friends sharing food at table", "people eating together restaurant", "family dinner table"]),
    ("sunrise", ["golden sunrise aerial landscape", "sunrise drone nature", "golden hour fields aerial"]),
]

TARGET_W = 1920  # prefer a file about this wide (1080p — sharp on portrait phones)
MAX_W = 2100     # allow 2048-wide "1080p" encodes (e.g. forest)

# Per-scene width cap, for clips whose 1080p file is too heavy to preload on
# mobile before the user scrolls to it. The sea clip is long; 720p water hides
# the softness fine and keeps it light.
SCENE_CAP_W: dict[str, int] = {"sea": 1280}

# Once a clip is approved we PIN it by Pexels id so a re-fetch keeps the exact
# footage (and only upgrades resolution) instead of re-searching. Edit a term
# above + remove the pin here to deliberately swap a scene.
PINNED: dict[str, int] = {
    "mountains": 26835570,  # drone aerial over peak, golden sun flare
    "sea": 26341148,        # turquoise ocean aerial
    "forest": 8744961,      # green forest + lake
    "produce": 5906562,     # clean ingredients on wooden board
    "cooking": 7008577,     # chef at griddle
    "dining": 31631562,     # warm ristorante interior
    "sharing": 3970179,     # sharing platter + drinks
    "sunrise": 26555448,    # golden sunrise over clouds
}


def read_key() -> str:
    txt = KEY_FILE.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"api key\s*:\s*(\S+)", txt, re.I)
    if not m:
        sys.exit("No Pexels API key found in " + str(KEY_FILE))
    return m.group(1)


def req(url: str, key: str, tries: int = 3) -> bytes:
    r = urllib.request.Request(url, headers={"Authorization": key, "User-Agent": "Mise/1.0"})
    last: Exception | None = None
    for _ in range(tries):
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001 — retry transient network errors
            last = e
    raise last  # type: ignore[misc]


def search(key: str, q: str) -> list[dict]:
    qs = urllib.parse.urlencode({"query": q, "per_page": 8, "orientation": "landscape"})
    data = json.loads(req(f"https://api.pexels.com/videos/search?{qs}", key).decode("utf-8"))
    return data.get("videos", [])


def get_video(key: str, vid: int) -> dict:
    return json.loads(req(f"https://api.pexels.com/videos/videos/{vid}", key).decode("utf-8"))


def pick_file(v: dict, cap_w: int = MAX_W, target_w: int = TARGET_W) -> dict | None:
    files = [f for f in v.get("video_files", []) if f.get("link")]
    if not files:
        return None
    # files no wider than cap_w, closest to target_w (sharp but lean)
    pool = [f for f in files if (f.get("width") or 0) <= cap_w] or files
    pool.sort(key=lambda f: abs((f.get("width") or 0) - target_w))
    return pool[0]


# Mobile tier: small, low-decode clips for phones (saved as <scene>-m.mp4).
# Phones download/decode these; desktop keeps the crisp 1080p.
MOBILE_W = 960  # ~540p — light to decode, fine behind the scrim on a small screen


def main() -> None:
    key = read_key()
    OUT.mkdir(parents=True, exist_ok=True)
    args = sys.argv[1:]
    mobile = "mobile" in args
    only = {a for a in args if a != "mobile"}
    suffix = "-m" if mobile else ""
    cfile = OUT / "pexels_credits.json"
    credits = {c["scene"]: c for c in json.loads(cfile.read_text())} if cfile.exists() else {}

    for name, terms in SCENES:
        if only and name not in only:
            continue
        chosen = None
        cap = MOBILE_W if mobile else SCENE_CAP_W.get(name, MAX_W)
        tgt = MOBILE_W if mobile else min(TARGET_W, cap)
        # Pinned scene: re-fetch the exact approved clip by id (upgrade res only).
        if name in PINNED:
            try:
                v = get_video(key, PINNED[name])
                f = pick_file(v, cap_w=cap, target_w=tgt)
                if f:
                    chosen = (f"id:{PINNED[name]}", v, f)
            except Exception as e:  # noqa: BLE001
                print(f"  ! pinned id {PINNED[name]}: {e}")
        for term in [] if chosen else terms:
            try:
                vids = search(key, term)
            except Exception as e:  # noqa: BLE001
                print(f"  ! '{term}': {e}")
                continue
            # Prefer short clips (~5-16s) — they loop fine as a backdrop and keep
            # file size down; fall back to shortest available.
            short = [v for v in vids if 4 <= (v.get("duration") or 0) <= 16] or vids
            short.sort(key=lambda v: v.get("duration") or 999)
            for v in short:
                f = pick_file(v, cap_w=cap, target_w=tgt)
                if f:
                    chosen = (term, v, f)
                    break
            if chosen:
                break
        if not chosen:
            print(f"[{name}] NO RESULT")
            continue
        term, v, f = chosen
        (OUT / f"{name}{suffix}.mp4").write_bytes(req(f["link"], key))
        if not mobile:  # desktop fetch also grabs the poster; mobile reuses it
            poster = v.get("image")
            if poster:
                try:
                    (OUT / f"{name}.jpg").write_bytes(req(poster, key))
                except Exception:  # noqa: BLE001
                    poster = None
            credits[name] = {
                "scene": name, "term": term, "id": v["id"], "width": f.get("width"),
                "height": f.get("height"), "user": v.get("user", {}).get("name"), "url": v.get("url"),
            }
        mb = (OUT / f"{name}{suffix}.mp4").stat().st_size / 1_000_000
        print(f"[{name}{suffix}] '{term}' id={v['id']} {f.get('width')}x{f.get('height')} {f.get('quality')} {mb:.1f}MB")
    if not mobile:
        cfile.write_text(json.dumps(list(credits.values()), indent=2), encoding="utf-8")
    total = sum(
        (OUT / f"{n}{suffix}.mp4").stat().st_size for n, _ in SCENES if (OUT / f"{n}{suffix}.mp4").exists()
    )
    print(f"\nDONE -> {OUT} · total {total/1_000_000:.1f}MB")


if __name__ == "__main__":
    main()
