"""Convert the site's photography to WebP, keeping the JPEGs as fallback.

Photographs are the heaviest thing the app ships and the slowest thing on a
phone on a kitchen's wifi. WebP is ~30–40% smaller than the equivalent JPEG at
the same visual quality — measured on THESE files rather than assumed, because
the often-quoted 60–70% is for unoptimised sources and these are already
compressed.

Two rules:

**Nothing is deleted.** Each `<picture>` keeps the JPEG as its fallback source,
so a browser that cannot take WebP still gets a photo rather than a gap. The
saving comes from the browser choosing, not from us removing the choice.

**Skip anything that does not get smaller.** A "conversion" that adds bytes is
just a second copy to serve, and it happens on small, already-tight images.

    python scripts/to_webp.py            # convert + report
    python scripts/to_webp.py --report   # measure only, write nothing
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "frontend" / "public"

# The photography. Icons and logos are SVG and already tiny; the dev album has
# its own build pipeline (scripts/build_dev_album.py) and is left to it.
FOLDERS = ("site", "experience", "dishes", "chef")

QUALITY = 82  # visually indistinguishable from the JPEGs at these sizes


def convert(path: Path, dry: bool) -> tuple[int, int] | None:
    out = path.with_suffix(".webp")
    before = path.stat().st_size
    if out.exists() and out.stat().st_mtime >= path.stat().st_mtime:
        return before, out.stat().st_size

    with Image.open(path) as im:
        im = im.convert("RGB")
        if dry:
            import io as _io

            buf = _io.BytesIO()
            im.save(buf, "WEBP", quality=QUALITY, method=6)
            return before, buf.tell()
        im.save(out, "WEBP", quality=QUALITY, method=6)

    after = out.stat().st_size
    # A conversion that grows the file is a second copy to serve for nothing.
    if after >= before:
        out.unlink()
        return None
    return before, after


def main() -> None:
    dry = "--report" in sys.argv
    total_before = total_after = 0
    converted = skipped = 0

    for folder in FOLDERS:
        base = ROOT / folder
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            result = convert(path, dry)
            if result is None:
                skipped += 1
                continue
            before, after = result
            total_before += before
            total_after += after
            converted += 1
            print(
                f"  {path.relative_to(ROOT)}  {before // 1024}K -> {after // 1024}K "
                f"({100 - after * 100 // max(1, before)}% smaller)"
            )

    if total_before:
        pct = 100 - total_after * 100 // total_before
        print(
            f"\n{converted} images: {total_before // 1024}K -> {total_after // 1024}K "
            f"({pct}% smaller){' - nothing written' if dry else ''}"
        )
    if skipped:
        print(f"{skipped} skipped (WebP was not smaller)")


if __name__ == "__main__":
    main()
