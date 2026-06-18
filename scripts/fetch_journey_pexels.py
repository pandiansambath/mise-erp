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
    ("mountains", ["aerial mountains clouds", "mountain lake landscape", "misty mountains valley"]),
    ("sea", ["turquoise ocean aerial", "blue sea waves aerial", "tropical ocean drone"]),
    ("forest", ["aerial forest sunlight", "green forest trees", "sunlight through forest"]),
    ("produce", ["fresh vegetables market", "farmers market produce", "vegetables on table"]),
    ("cooking", ["chef cooking restaurant kitchen", "chef plating food", "flames cooking pan"]),
    ("dining", ["fine dining restaurant interior", "cozy restaurant evening", "restaurant table candle"]),
    ("sharing", ["friends sharing food at table", "people eating together restaurant", "family dinner table"]),
    ("sunrise", ["golden sunrise aerial landscape", "sunrise drone nature", "golden hour fields aerial"]),
]

TARGET_W = 1280  # prefer an HD file about this wide
MAX_W = 1920


def read_key() -> str:
    txt = KEY_FILE.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"api key\s*:\s*(\S+)", txt, re.I)
    if not m:
        sys.exit("No Pexels API key found in " + str(KEY_FILE))
    return m.group(1)


def req(url: str, key: str) -> bytes:
    r = urllib.request.Request(url, headers={"Authorization": key, "User-Agent": "Mise/1.0"})
    with urllib.request.urlopen(r, timeout=90) as resp:
        return resp.read()


def search(key: str, q: str) -> list[dict]:
    qs = urllib.parse.urlencode({"query": q, "per_page": 8, "orientation": "landscape"})
    data = json.loads(req(f"https://api.pexels.com/videos/search?{qs}", key).decode("utf-8"))
    return data.get("videos", [])


def pick_file(v: dict) -> dict | None:
    files = [f for f in v.get("video_files", []) if f.get("link")]
    if not files:
        return None
    # HD files no wider than MAX_W, closest to TARGET_W (sharp but lean)
    hd = [f for f in files if f.get("quality") == "hd" and (f.get("width") or 0) <= MAX_W]
    pool = hd or [f for f in files if (f.get("width") or 0) <= MAX_W] or files
    pool.sort(key=lambda f: abs((f.get("width") or 0) - TARGET_W))
    return pool[0]


def main() -> None:
    key = read_key()
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    cfile = OUT / "pexels_credits.json"
    credits = {c["scene"]: c for c in json.loads(cfile.read_text())} if cfile.exists() else {}

    for name, terms in SCENES:
        if only and name not in only:
            continue
        chosen = None
        for term in terms:
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
                f = pick_file(v)
                if f:
                    chosen = (term, v, f)
                    break
            if chosen:
                break
        if not chosen:
            print(f"[{name}] NO RESULT")
            continue
        term, v, f = chosen
        (OUT / f"{name}.mp4").write_bytes(req(f["link"], key))
        poster = v.get("image")
        if poster:
            try:
                (OUT / f"{name}.jpg").write_bytes(req(poster, key))
            except Exception:  # noqa: BLE001
                poster = None
        mb = (OUT / f"{name}.mp4").stat().st_size / 1_000_000
        print(f"[{name}] '{term}' id={v['id']} {f.get('width')}x{f.get('height')} {f.get('quality')} {mb:.1f}MB")
        credits[name] = {
            "scene": name, "term": term, "id": v["id"], "width": f.get("width"),
            "height": f.get("height"), "user": v.get("user", {}).get("name"), "url": v.get("url"),
        }
    cfile.write_text(json.dumps(list(credits.values()), indent=2), encoding="utf-8")
    total = sum((OUT / f"{n}.mp4").stat().st_size for n, _ in SCENES if (OUT / f"{n}.mp4").exists())
    print(f"\nDONE -> {OUT} · total {total/1_000_000:.1f}MB")


if __name__ == "__main__":
    main()
