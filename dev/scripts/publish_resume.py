"""Publish his finished résumé to the profile page.

    "create a section ... add our finalized resume there (keep resume in s3 and
     serve to site) ... open inplace in a neat way adapted based on screen size
     also have a download option too pdf, word"

Same road as the album (build_dev_album.py): built here, uploaded to the
PRIVATE uploads bucket under dev-site/resume/, and served only through
backend/app/api/dev_site.py, which reads an exact list of names. Nothing lands
in the repository, which is public.

WHAT GOES UP
    Pandian_Sambath_Resume.pdf / .docx   the downloads, under one clean name
                                         (the working copies end in _v2)
    page-1.webp, page-2.webp, …          every page as an image, for the viewer
    thumb.webp                           a small cover for the card
    resume.json                          what the page reads: version, page sizes

WHY PAGE IMAGES, NOT THE PDF IN AN <iframe>
    Most phones will not draw a PDF inside a page — Android Chrome offers a
    download instead — and the brief is a viewer that works on every screen.
    The images ARE the pages, rendered once here; the PDF stays one tap away for
    anyone who wants to select text or print.

The version in resume.json is a hash of the PDF. The page puts it on every URL
(`?v=…`), so a republished résumé is never hidden behind a cached old one.

Run:  python dev/scripts/publish_resume.py            (needs the AWS CLI signed in)
      python dev/scripts/publish_resume.py --dry-run  (build only, upload nothing)
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC_PDF = ROOT / "resume" / "Pandian_Sambath_Resume_v2.pdf"
SRC_DOCX = SRC_PDF.with_suffix(".docx")
NAME = "Pandian_Sambath_Resume"

# Built locally under the album's git-ignored build folder, then uploaded.
OUT = ROOT / "dev" / "build" / "resume"
BUCKET = "s3://mise-uploads-887514555232/dev-site/resume/"

# 1800px wide: sharp on a 2x phone, and on a desktop viewer up to ~900px wide.
PAGE_WIDTH = 1800
# The card shows the cover about 95px wide; 360px covers a 3x phone.
THUMB_WIDTH = 360


def render(page: pymupdf.Page, width: int, target: Path, lossless: bool) -> dict:
    zoom = width / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if lossless:
        # A page of text is flat colour and sharp edges, which lossless WebP
        # packs far better than lossy: 210 KB a page instead of 530 KB, and no
        # smudge around the letters. Measured on this résumé, not assumed.
        img.save(target, "WEBP", lossless=True, quality=100, method=6)
    else:
        img.save(target, "WEBP", quality=72, method=6)
    return {"src": target.name, "w": img.width, "h": img.height}


def main() -> None:
    dry = "--dry-run" in sys.argv
    for f in (SRC_PDF, SRC_DOCX):
        if not f.exists():
            sys.exit(f"missing {f} — finish the résumé first")

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    pdf_bytes = SRC_PDF.read_bytes()
    shutil.copyfile(SRC_PDF, OUT / f"{NAME}.pdf")
    shutil.copyfile(SRC_DOCX, OUT / f"{NAME}.docx")

    doc = pymupdf.open(SRC_PDF)
    pages = [render(p, PAGE_WIDTH, OUT / f"page-{i + 1}.webp", lossless=True) for i, p in enumerate(doc)]
    thumb = render(doc[0], THUMB_WIDTH, OUT / "thumb.webp", lossless=False)

    manifest = {
        "version": hashlib.sha256(pdf_bytes).hexdigest()[:12],
        "updated": date.today().isoformat(),
        "pdf": f"{NAME}.pdf",
        "docx": f"{NAME}.docx",
        "pdfKB": round(len(pdf_bytes) / 1024),
        "docxKB": round(SRC_DOCX.stat().st_size / 1024),
        "thumb": thumb,
        "pages": pages,
    }
    (OUT / "resume.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:<32} {f.stat().st_size / 1024:8.0f} KB")
    print(f"version {manifest['version']} · {len(pages)} pages")

    if dry:
        print("dry run — nothing uploaded")
        return
    # --delete is safe here: it only ever touches dev-site/resume/, and it is
    # what removes page-3.webp if a future résumé is two pages again.
    print(f"\nuploading to {BUCKET} …")
    subprocess.run(["aws", "s3", "sync", str(OUT), BUCKET, "--delete", "--only-show-errors"], check=True)
    print("uploaded — the page shows it on the next load")


if __name__ == "__main__":
    main()
