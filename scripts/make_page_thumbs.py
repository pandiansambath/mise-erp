#!/usr/bin/env python3
"""Small thumbnails for the picture shelf.

WHY THIS EXISTS

The shelf shows each photograph in a 4:3 tile a few centimetres across, and it
was showing the FULL hero image to do it — around 300 KB each. That was
tolerable at six pictures a mood. Doubling the library to twelve would have
doubled the cost of opening a mood to roughly 3.6 MB, on a screen a restaurant
owner opens to browse.

So the shelf gets its own 480px-wide copies. The full image is still what the
page uses; this is only what the picker draws.

    python scripts/make_page_thumbs.py          # build any that are missing
    python scripts/make_page_thumbs.py --force  # rebuild all

Idempotent: a thumb that already exists and is newer than its source is left
alone, so re-running after a fetch only does the new ones.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - a clear message beats a traceback
    sys.exit("Pillow is needed: pip install Pillow")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend" / "public" / "page-images"
OUT = SRC / "thumbs"

#: Wide enough for a 3-across grid on a desktop panel at 2x, and no wider.
WIDTH = 480
#: 78 is where these photographs stop losing anything the eye can find at this
#: size. Checked by looking, not by picking a round number.
QUALITY = 78


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="rebuild even if up to date")
    args = ap.parse_args()

    if not SRC.exists():
        sys.exit(f"No image library at {SRC}")
    OUT.mkdir(parents=True, exist_ok=True)

    made = skipped = 0
    src_bytes = out_bytes = 0
    for f in sorted(SRC.glob("*.jpg")):
        dest = OUT / f.name
        src_bytes += f.stat().st_size
        if dest.exists() and not args.force and dest.stat().st_mtime >= f.stat().st_mtime:
            out_bytes += dest.stat().st_size
            skipped += 1
            continue
        with Image.open(f) as im:
            im = im.convert("RGB")
            w, h = im.size
            if w > WIDTH:
                im = im.resize((WIDTH, round(h * WIDTH / w)), Image.LANCZOS)
            im.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        out_bytes += dest.stat().st_size
        made += 1

    print(f"{made} built, {skipped} already current")
    print(f"full library {src_bytes / 1048576:.1f} MB  ->  thumbs {out_bytes / 1048576:.1f} MB")
    if src_bytes:
        print(f"the picker now loads {100 * out_bytes / src_bytes:.0f}% of what it did")
    return 0


if __name__ == "__main__":
    sys.exit(main())
