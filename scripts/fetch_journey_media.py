#!/usr/bin/env python3
"""Fetch real, royalty-free video clips for the landing journey from Pixabay.

For each "scene" we try a few search terms, pick the most-viewed clip that has a
usable size, and download a compact version (+ its poster frame) into
frontend/public/journey/. Writes credits.json for attribution.

The API key is read at runtime from the gitignored docs file, never hardcoded.
Run:  python scripts/fetch_journey_media.py
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY_FILE = ROOT / "docs" / "pixabay_api_and_doc.txt"
OUT = ROOT / "frontend" / "public" / "journey"

# scene name -> ordered search terms (first that yields a good hit wins)
SCENES: list[tuple[str, list[str]]] = [
    ("hills-dawn", ["misty mountains morning", "mountain sunrise fog", "sunrise valley nature"]),
    ("prep-calm", ["chef preparing ingredients", "chef cutting vegetables", "cooking preparation hands"]),
    ("harvest", ["fresh vegetables market", "vegetables harvest", "fresh produce farm"]),
    ("cooking", ["fire flames cooking food", "wok stir fry fire", "grill flames food", "flambe cooking fire"]),
    ("dark-street", ["city street night rain", "city lights night", "rainy street night"]),
    ("dining-warm", ["fine dining restaurant", "restaurant interior evening", "busy restaurant ambiance"]),
    ("entrance", ["hotel lobby luxury", "restaurant interior warm lights", "corridor walking lights", "elegant interior chandelier"]),
    ("tablet", ["person using tablet cafe", "tablet restaurant", "laptop coffee work"]),
    ("plated", ["gourmet plated dish", "chef plating food", "fine dining plate"]),
]

# Pick the highest-resolution clip whose file fits this budget (keeps the page
# fast + the repo lean). No transcoding tools are available locally, so we let
# Pixabay's own size variants do the compression.
BUDGET = 2_600_000
UA = {"User-Agent": "Mozilla/5.0 (MiseERP journey media fetcher)"}


def read_key() -> str:
    txt = KEY_FILE.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"\b(\d{6,}-[0-9a-fA-F]{20,})\b", txt)
    if not m:
        sys.exit("Could not find a Pixabay API key in " + str(KEY_FILE))
    return m.group(1)


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def search(key: str, term: str) -> list[dict]:
    q = urllib.parse.urlencode(
        {
            "key": key,
            "q": term,
            "video_type": "film",
            "per_page": 12,
            "safesearch": "true",
            "order": "popular",
        }
    )
    data = json.loads(get(f"https://pixabay.com/api/videos/?{q}").decode("utf-8"))
    return data.get("hits", [])


def pick_size(videos: dict) -> tuple[str, dict] | None:
    avail = [(s, videos[s]) for s in ("large", "medium", "small", "tiny")
             if videos.get(s) and videos[s].get("url")]
    if not avail:
        return None
    area = lambda v: (v.get("width") or 0) * (v.get("height") or 0)  # noqa: E731
    under = [(s, v) for s, v in avail if (v.get("size") or 10**12) <= BUDGET]
    if under:  # highest resolution that fits the budget
        under.sort(key=lambda sv: area(sv[1]), reverse=True)
        return under[0]
    avail.sort(key=lambda sv: sv[1].get("size") or 10**12)  # else the smallest file
    return avail[0]


def main() -> None:
    key = read_key()
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])  # optional: re-fetch just the named scenes
    credits: list[dict] = []
    for name, terms in SCENES:
        if only and name not in only:
            continue
        chosen = None
        fallback = None  # smallest clip seen, used only if nothing fits the budget
        for term in terms:
            try:
                hits = search(key, term)
            except Exception as e:  # noqa: BLE001
                print(f"  ! search '{term}' failed: {e}")
                continue
            # most-viewed first; prefer a clip that actually fits the budget
            for h in sorted(hits, key=lambda x: x.get("views", 0), reverse=True):
                ps = pick_size(h.get("videos", {}))
                if not ps:
                    continue
                size = ps[1].get("size") or 10**12
                if size <= BUDGET:
                    chosen = (term, h, ps)
                    break
                if fallback is None or size < (fallback[2][1].get("size") or 10**12):
                    fallback = (term, h, ps)
            if chosen:
                break
        chosen = chosen or fallback
        if not chosen:
            print(f"[{name}] NO RESULT")
            continue
        term, h, (size_name, v) = chosen
        vid = get(v["url"])
        (OUT / f"{name}.mp4").write_bytes(vid)
        poster = v.get("thumbnail") or ""
        if poster:
            try:
                (OUT / f"{name}.jpg").write_bytes(get(poster))
            except Exception:  # noqa: BLE001
                poster = ""
        mb = len(vid) / 1_000_000
        print(
            f"[{name}] '{term}' -> id={h['id']} {size_name} "
            f"{v.get('width')}x{v.get('height')} {mb:.1f}MB views={h.get('views')}"
        )
        credits.append(
            {
                "scene": name,
                "term": term,
                "id": h["id"],
                "size": size_name,
                "width": v.get("width"),
                "height": v.get("height"),
                "bytes": len(vid),
                "user": h.get("user"),
                "pageURL": h.get("pageURL"),
                "poster": bool(poster),
            }
        )
    # merge into any existing manifest so re-fetching a subset keeps the rest
    cfile = OUT / "credits.json"
    merged: dict[str, dict] = {}
    if cfile.exists():
        for c in json.loads(cfile.read_text(encoding="utf-8")):
            merged[c["scene"]] = c
    for c in credits:
        merged[c["scene"]] = c
    out = list(merged.values())
    cfile.write_text(json.dumps(out, indent=2), encoding="utf-8")
    total = sum(c["bytes"] for c in out) / 1_000_000
    print(f"\nDONE: refreshed {len(credits)}, manifest has {len(out)} scenes, total {total:.1f}MB -> {OUT}")


if __name__ == "__main__":
    main()
