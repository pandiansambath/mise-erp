"""Fetch the hero photography for the per-hotel subdomain landing page.

Each hotel picks one HERO STYLE in Settings; this downloads one worthy landscape
photo per style into frontend/public/site/. Pexels licence: free to use, no
attribution required. The API key is read at runtime from the gitignored docs
file, never hardcoded.

Usage:  python scripts/fetch_hotel_site_photos.py
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
OUT = ROOT / "frontend" / "public" / "site"

# style -> search terms (first hit with a good aspect wins)
STYLES: dict[str, list[str]] = {
    "warm": ["warm restaurant interior evening", "cozy restaurant lights"],
    "fine": ["fine dining plated dish", "gourmet plate restaurant"],
    "rustic": ["rustic wooden table restaurant", "rustic cafe interior"],
    "spice": ["indian spices bowls", "colorful spices market"],
    "cafe": ["bright cafe interior daylight", "modern coffee shop interior"],
    "night": ["restaurant bar night moody", "dim restaurant table candle"],
}


def read_key() -> str:
    txt = KEY_FILE.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"[A-Za-z0-9]{40,}", txt)
    if not m:
        sys.exit("No Pexels API key found in " + str(KEY_FILE))
    return m.group(0)


def req(url: str, key: str) -> bytes:
    r = urllib.request.Request(url, headers={"Authorization": key, "User-Agent": "Mise/1.0"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return resp.read()


def fetch(key: str, style: str, terms: list[str]) -> None:
    dest = OUT / f"hero-{style}.jpg"
    if dest.exists():
        print(f"  {style}: already have it")
        return
    for term in terms:
        qs = urllib.parse.urlencode(
            {"query": term, "orientation": "landscape", "per_page": 12, "size": "large"}
        )
        data = json.loads(req(f"https://api.pexels.com/v1/search?{qs}", key).decode("utf-8"))
        photos = data.get("photos") or []
        # widest landscape first — heroes are full-bleed
        photos.sort(key=lambda p: (p.get("width", 0) / max(p.get("height", 1), 1)), reverse=True)
        for p in photos:
            src = (p.get("src") or {}).get("large2x") or (p.get("src") or {}).get("large")
            if not src:
                continue
            blob = urllib.request.urlopen(
                urllib.request.Request(src, headers={"User-Agent": "Mise/1.0"}), timeout=90
            ).read()
            if len(blob) < 40_000:  # too small/low quality
                continue
            dest.write_bytes(blob)
            print(f"  {style}: {len(blob) // 1024} KB  ({p.get('photographer')}) — {term}")
            return
    print(f"  {style}: NOTHING FOUND")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    key = read_key()
    print(f"Fetching {len(STYLES)} hero photos -> {OUT}")
    for style, terms in STYLES.items():
        try:
            fetch(key, style, terms)
        except Exception as exc:  # noqa: BLE001 — one bad style shouldn't stop the rest
            print(f"  {style}: FAILED {exc}")


if __name__ == "__main__":
    main()
