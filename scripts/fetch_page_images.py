#!/usr/bin/env python3
"""Build the picture library a restaurant picks from when styling its pages.

    "please download as much as images from Pixabay and have that in our
     suggestion customisation list as landing and login page — for both
     download as much as possible photos and let user use any one whatever he
     likes for both pages."

WHY A BUNDLED LIBRARY AND NOT A LIVE SEARCH BOX
A search box is the wrong tool here. It asks a restaurant owner to be a picture
editor — to know what to search for, judge crops, and tell a usable hero
photograph from a busy one — at the moment they are trying to get their page
looking right. It also puts a third-party API in the render path of the one
page a customer sees, and leaks a key to the browser.

So the pictures are chosen once, here, and shipped with the app. Browsing a
shelf of forty pictures that are all known to work is a different and much
easier job than searching a stock site.

WHY THE TWO PAGES GET DIFFERENT SHELVES
A landing page sells the food: it wants appetite, colour, a full plate. A staff
sign-in page is opened at 6am by somebody who works there — it wants calm, dark,
textural, and crucially NOT busy, because a form sits on top of it and text has
to stay readable over it. Offering one list for both is how you end up with
login pages that nobody can read.

Everything here is Pixabay Content-License: free for commercial use, no
attribution required. `credits.json` records the source anyway, because
knowing where an asset came from is worth more than the licence requires.

Run:  python scripts/fetch_page_images.py           # both shelves
      python scripts/fetch_page_images.py --check   # what is already there
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY_FILE = ROOT / "docs" / "pixabay_api_and_doc.txt"
OUT = ROOT / "frontend" / "public" / "page-images"

#: How many to keep per mood. Enough to feel like a choice, few enough that the
#: whole shelf is scannable without scrolling for a minute.
PER_MOOD = 6

#: The widest Pixabay variant we take. A hero photo is displayed full-bleed, so
#: the 640px preview is visibly soft on a laptop; 1280 is sharp enough
#: everywhere and still ~200-400 KB.
SIZE_KEYS = ("largeImageURL", "webformatURL")

#: Hard ceiling per file. A landing page that takes four seconds to paint has
#: not been helped by a beautiful photograph.
MAX_BYTES = 900_000

# ── THE SHELVES ────────────────────────────────────────────────────────────
# (slug, human label, for which page, search terms best-first)
Shelf = tuple[str, str, str, list[str]]

MOODS: list[Shelf] = [
    # ---- LANDING: sell the food -------------------------------------------
    ("feast", "A table full of food", "landing",
     ["indian feast table", "food spread table overhead", "dinner table food friends"]),
    ("curry", "Curry and spice", "landing",
     ["indian curry bowl", "curry spices bowl", "masala curry dish"]),
    ("grill", "Fire and grill", "landing",
     ["tandoor grill meat", "barbecue flames food", "grilled skewers fire"]),
    ("fresh", "Fresh ingredients", "landing",
     ["fresh vegetables market", "herbs spices ingredients", "vegetables wooden board"]),
    ("sweet", "Something sweet", "landing",
     ["indian sweets dessert", "dessert plate elegant", "cake dessert closeup"]),
    ("dining-room", "The dining room", "landing",
     ["restaurant interior warm", "restaurant table setting", "cafe interior cosy"]),
    ("street", "Street food", "landing",
     ["street food stall", "food market night", "indian street food"]),
    ("drinks", "Drinks and chai", "landing",
     ["masala chai cup", "cocktail bar drinks", "lassi drink glass"]),

    # ---- SIGN-IN: calm, dark, quiet ---------------------------------------
    # Deliberately textural rather than photographic subjects. A form sits on
    # top of these, so anything with a strong focal point or busy detail in the
    # middle is a worse background however good a picture it is.
    ("slate", "Dark slate", "login",
     ["dark slate texture", "black stone surface", "dark concrete wall"]),
    ("wood", "Warm wood", "login",
     ["dark wood texture", "walnut wood surface", "wooden table dark"]),
    ("linen", "Cloth and linen", "login",
     ["dark linen fabric texture", "cloth texture dark", "canvas texture neutral"]),
    ("marble", "Marble and stone", "login",
     ["dark marble texture", "marble surface black", "granite texture dark"]),
    ("kitchen-quiet", "A quiet kitchen", "login",
     ["empty restaurant kitchen", "stainless steel kitchen", "kitchen counter clean"]),
    ("dawn", "Early light", "login",
     ["sunrise minimal sky", "morning light window", "soft gradient sunrise"]),
    ("spice-dark", "Spices on dark", "login",
     ["spices dark background", "star anise dark", "cinnamon spices moody"]),
    ("copper", "Copper and brass", "login",
     ["copper pots kitchen", "brass texture", "copper surface texture"]),
]


def api_key() -> str:
    """Read the key from the gitignored docs file. Never hardcoded, never
    printed — a leaked key on a free tier is somebody else's rate limit."""
    if not KEY_FILE.exists():
        sys.exit(f"No Pixabay key file at {KEY_FILE}")
    text = KEY_FILE.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"\b[0-9]{6,9}-[A-Za-z0-9]{20,}\b", text)
    if not m:
        sys.exit(f"No Pixabay-shaped key found in {KEY_FILE}")
    return m.group(0)


def search(key: str, term: str, *, want: int) -> list[dict]:
    url = "https://pixabay.com/api/?" + urllib.parse.urlencode(
        {
            "key": key,
            "q": term,
            "image_type": "photo",
            "orientation": "horizontal",
            # A hero image is wide; portrait shots crop badly and a 4:3 snapshot
            # looks like a snapshot.
            "min_width": 1920,
            "safesearch": "true",
            "order": "popular",
            "per_page": max(want * 3, 20),
        }
    )
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return json.loads(r.read().decode()).get("hits", [])
    except urllib.error.HTTPError as e:
        print(f"    ! {term}: HTTP {e.code}")
        return []
    except Exception as e:  # noqa: BLE001 - a fetch script should not die on one term
        print(f"    ! {term}: {type(e).__name__}")
        return []


def download(url: str, dest: Path) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": "dineai-asset-fetch"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if len(data) > MAX_BYTES:
        return 0
    dest.write_bytes(data)
    return len(data)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report what exists, fetch nothing")
    ap.add_argument("--per-mood", type=int, default=PER_MOOD)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "images.json"

    if args.check:
        have = sorted(p.name for p in OUT.glob("*.jpg"))
        print(f"{len(have)} images in {OUT}")
        if manifest_path.exists():
            m = json.loads(manifest_path.read_text(encoding="utf-8"))
            for page in ("landing", "login"):
                n = sum(len(g["images"]) for g in m["moods"] if g["page"] == page)
                print(f"  {page}: {n}")
        return 0

    key = api_key()
    moods_out: list[dict] = []
    credits: list[dict] = []
    seen_ids: set[int] = set()
    total = 0

    for slug, label, page, terms in MOODS:
        print(f"\n{label}  ({page})")
        picked: list[dict] = []
        for term in terms:
            if len(picked) >= args.per_mood:
                break
            for hit in search(key, term, want=args.per_mood):
                if len(picked) >= args.per_mood:
                    break
                # The same photograph turns up under several searches; a shelf
                # that shows one picture twice looks broken.
                if hit["id"] in seen_ids:
                    continue
                src = next((hit[k] for k in SIZE_KEYS if hit.get(k)), None)
                if not src:
                    continue
                name = f"{slug}-{hit['id']}.jpg"
                try:
                    n = download(src, OUT / name)
                except Exception as e:  # noqa: BLE001
                    print(f"    ! {hit['id']}: {type(e).__name__}")
                    continue
                if not n:
                    continue  # over the size budget
                seen_ids.add(hit["id"])
                picked.append(
                    {
                        "file": f"/page-images/{name}",
                        "alt": (hit.get("tags") or label).split(",")[0].strip(),
                    }
                )
                credits.append(
                    {
                        "file": name,
                        "source": "pixabay",
                        "id": hit["id"],
                        "page_url": hit.get("pageURL"),
                        "user": hit.get("user"),
                    }
                )
                total += 1
                print(f"    + {name}  {n // 1024} KB")
        moods_out.append({"slug": slug, "label": label, "page": page, "images": picked})

    manifest_path.write_text(
        json.dumps({"moods": moods_out}, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (OUT / "credits.json").write_text(
        json.dumps(credits, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\n{total} images, {len(moods_out)} moods -> {OUT}")
    print("manifest: frontend/public/page-images/images.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
