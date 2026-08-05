"""Turn 158MB of phone photos into an album that can load before you see it.

The source album is 34 shots straight off a phone — 2304x4096 and up, 5-15MB
each. "Preload everything before entering" is impossible at that size, so the
album is built in three tiers and each one exists for a different moment:

  LQIP   ~24px wide WebP, inlined as base64 in the page itself.
         Renders on first paint with zero requests. This is what makes the
         album feel instant rather than merely fast.

  THUMB  720px WebP. What the grid actually shows, and the only tier preloaded
         before the album opens. ~35KB each, so the whole grid is ~1.2MB —
         small enough to fetch during the intro animation.

  FULL   1800px WebP. Fetched only when a photo is opened. Nobody views 34
         full-size photos, so paying for them upfront is waste.

EXIF orientation is applied, not stripped-and-ignored: phone photos carry a
rotation flag, and dropping it silently turns portraits sideways. exif_transpose
bakes the rotation into the pixels so no viewer has to honour the flag.

All other EXIF is DISCARDED on purpose — the originals carry GPS coordinates,
and publishing a personal album should not publish where each photo was taken.

Run:  python scripts/build_dev_album.py
"""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageOps

# Anchored to the repo root, not the working directory: this script moved into
# dev/scripts/ and "python dev/scripts/build_dev_album.py" from
# anywhere must still find the same two folders.
ROOT = Path(__file__).resolve().parent.parent.parent
SRC = ROOT / "my_photos"
# The images MUST stay under frontend/public — that is the only directory Next
# serves statically. Everything else about this page lives in dev/.
OUT = ROOT / "frontend" / "public" / "dev"
TIERS = {"thumb": (720, 74), "full": (1800, 82)}
LQIP_WIDTH = 24


def _load(path: Path) -> Image.Image:
    """Open, apply EXIF rotation, drop everything else, convert to RGB."""
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)  # bake rotation into pixels
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    # Re-create from raw pixels so no EXIF (incl. GPS) survives into the output.
    clean = Image.new(im.mode, im.size)
    clean.putdata(list(im.getdata()))
    return clean


def _resize(im: Image.Image, long_edge: int) -> Image.Image:
    w, h = im.size
    if max(w, h) <= long_edge:
        return im
    scale = long_edge / max(w, h)
    return im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def _lqip(im: Image.Image) -> str:
    """A base64 WebP small enough to inline. Blurred by being tiny, then
    stretched by the browser — no blur filter needed."""
    w, h = im.size
    tiny = im.resize((LQIP_WIDTH, max(1, round(h * LQIP_WIDTH / w))), Image.LANCZOS)
    buf = io.BytesIO()
    tiny.save(buf, "WEBP", quality=50)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    album_src = sorted((SRC / "album").glob("*.jpg"))
    if not album_src:
        raise SystemExit(f"no photos found in {SRC / 'album'}")

    for tier in TIERS:
        (OUT / tier).mkdir(parents=True, exist_ok=True)

    manifest = []
    saved_from = 0
    saved_to = 0

    for i, path in enumerate(album_src):
        im = _load(path)
        saved_from += path.stat().st_size
        slug = f"p{i:02d}"
        for tier, (edge, quality) in TIERS.items():
            out = OUT / tier / f"{slug}.webp"
            _resize(im, edge).save(out, "WEBP", quality=quality, method=6)
            saved_to += out.stat().st_size
        w, h = im.size
        manifest.append({
            "id": slug,
            "w": w,
            "h": h,
            # Aspect ratio drives the grid so tiles reserve their space before
            # the image lands — otherwise the layout jumps as photos arrive.
            "ratio": round(w / h, 4),
            "lqip": _lqip(im),
        })
        print(f"  {path.name} -> {slug} ({w}x{h})")

    # Profile photos. Both source shots are LANDSCAPE selfies, so a plain
    # centre crop would cut the face off — the subject sits right of centre in
    # both. These focus points were read off the images rather than guessed.
    profiles = [
        ("IMG_20260129_220319.jpg", "profile", 0.62, 0.34),
        ("photo_2026-04-16_16-24-53.jpg", "profile-alt", 0.60, 0.38),
    ]
    for filename, slug, fx, fy in profiles:
        src = SRC / filename
        if not src.exists():
            continue
        im = _load(src)
        w, h = im.size
        side = min(w, h)
        # Centre the square on the face, then clamp so it stays inside the frame.
        left = min(max(round(w * fx - side / 2), 0), w - side)
        top = min(max(round(h * fy - side / 2), 0), h - side)
        square = im.crop((left, top, left + side, top + side))
        _resize(square, 560).save(OUT / f"{slug}.webp", "WEBP", quality=88, method=6)
        print(f"  {slug} <- {filename}")

    (OUT / "album.json").write_text(json.dumps(manifest), encoding="utf-8")
    print(
        f"\n{len(manifest)} photos: {saved_from / 1e6:.0f}MB -> {saved_to / 1e6:.1f}MB "
        f"({100 - saved_to / saved_from * 100:.0f}% smaller)"
    )
    thumbs = sum(f.stat().st_size for f in (OUT / "thumb").glob("*.webp"))
    print(f"preloaded tier (thumbs only): {thumbs / 1e6:.2f}MB")


if __name__ == "__main__":
    main()
