"""The developer profile site's personal files, served from the PRIVATE bucket.

    "why the hell my photos is in github?? .... i said to keep photos in s3 and
     serve from there.... go remove my personal stuff like photo and resume...
     store in s3..from s3 u can serve them instead of direct codebase"

The album, the profile pictures and the rank list used to live in
`frontend/public/dev` — committed to a PUBLIC repository, so anyone could
download them from GitHub without ever visiting his page. They now live in the
uploads bucket under `dev-site/` and come out only through here.

The bucket stays private (all public access blocked). This route is the only
door, and it opens for an exact list of names — nothing else in the bucket, no
path tricks. And it honours the same off switch as the page
(`DEV_PROFILE_ENABLED`, see dev/scripts/toggle_dev_site.sh): a page that is off
must not leave its photos one URL away.
"""
import base64
import hashlib
import io
import json
import os
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import date
from typing import Literal

import bcrypt
from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.core.ratelimit import _client_ip
from app.core.storage import get_storage

router = APIRouter(prefix="/dev-site", tags=["dev-site"])

PREFIX = "dev-site/"

# The ONLY names that can be read. Anything else is a 404, which also rules
# out "../" and every other key in the bucket.
#
# `resume/` is his finished résumé (dev/scripts/publish_resume.py): the PDF and
# Word downloads, one image per page for the in-place viewer, a small cover
# thumbnail, and the manifest the page reads.
_ALLOWED = re.compile(
    r"^(?:(?:full|thumb)/p\d{2,3}\.webp"
    r"|profile(?:-alt)?\.webp"
    r"|RANK_AFF_UG_2023\.pdf"
    r"|album\.json"
    r"|milestones\.json|site\.json|music\.json"
    r"|music/[a-z0-9-]{1,48}\.(?:mp3|m4a|ogg)"
    r"|resume/(?:Pandian_Sambath_Resume\.(?:pdf|docx)|page-\d{1,2}\.webp|thumb\.webp|resume\.json))$"
)

_TYPES = {
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
}


def enabled() -> bool:
    """Same rule as the page itself (frontend/app/dev/page.tsx)."""
    raw = (os.environ.get("DEV_PROFILE_ENABLED") or "1").strip().lower()
    return raw not in {"0", "false", "off", "no"}


# ── His edits ────────────────────────────────────────────────────────────────
#
#   "i can click any block and add recognition or promotion… to restrict public
#    to add we can have a small password"   ·   "have a button to choose which
#    theme and design is default (use password …)"
#
# The password is checked HERE, never in the browser: the repository is public,
# so anything the page could check, anyone could read. Only a bcrypt hash
# exists, at dev-site/private/editor.hash in the private bucket — outside the
# read allow-list above, so it is never served. What he saves lands beside the
# album as milestones.json and site.json, which the page reads like any other
# file.

HASH_KEY = PREFIX + "private/editor.hash"

# Failed attempts only, per IP: a long editing session never locks him out, a
# script walking a word list stops after a handful.
_FAILS: dict[str, deque[float]] = defaultdict(deque)
FAIL_LIMIT, FAIL_WINDOW = 8, 900


def _authorise(request: Request, password: str) -> None:
    ip = _client_ip(request)
    now = time.monotonic()
    fails = _FAILS[ip]
    while fails and now - fails[0] > FAIL_WINDOW:
        fails.popleft()
    if len(fails) >= FAIL_LIMIT:
        raise HTTPException(429, "Too many wrong attempts. Try again in a few minutes.")
    try:
        stored = get_storage().read(HASH_KEY).strip()
    except FileNotFoundError:
        # No hash set up means nobody can edit — never "anyone can".
        raise HTTPException(503, "Editing is not set up.") from None
    if not password or not bcrypt.checkpw(password.encode()[:72], stored):
        fails.append(now)
        raise HTTPException(401, "Wrong password.")


class Unlock(BaseModel):
    password: str = Field(max_length=200)


MONTH = r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20\d\d$"


class Milestone(BaseModel):
    when: str = Field(pattern=MONTH)
    kind: Literal["recognition", "promotion", "milestone", "note"]
    title: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=240)
    promoted: str = Field(default="", max_length=60)


class SaveMilestones(Unlock):
    milestones: list[Milestone] = Field(max_length=240)


class SaveSite(Unlock):
    theme: str = Field(pattern=r"^[a-z0-9-]{1,32}$")
    design: str = Field(pattern=r"^[a-z0-9-]{1,32}$")


def _write(name: str, payload: object) -> None:
    get_storage().write(PREFIX + name, json.dumps(payload, ensure_ascii=False).encode())


@router.post("/unlock")
async def unlock(body: Unlock, request: Request) -> dict:
    if not enabled():
        raise HTTPException(404, "Not found")
    await run_in_threadpool(_authorise, request, body.password)
    return {"ok": True}


@router.put("/milestones")
async def save_milestones(body: SaveMilestones, request: Request) -> dict:
    if not enabled():
        raise HTTPException(404, "Not found")
    await run_in_threadpool(_authorise, request, body.password)
    items = [m.model_dump() for m in body.milestones]
    await run_in_threadpool(_write, "milestones.json", items)
    return {"ok": True, "count": len(items)}


@router.put("/site")
async def save_site(body: SaveSite, request: Request) -> dict:
    if not enabled():
        raise HTTPException(404, "Not found")
    await run_in_threadpool(_authorise, request, body.password)
    await run_in_threadpool(_write, "site.json", {"theme": body.theme, "design": body.design})
    return {"ok": True}


# ── His uploads: photos into the album, songs into the playlist ──────────────
#
#   "i can upload any photos to this site… also i can also upload any music…
#    change the order of the song… whether to use this song only in album or in
#    landing page too or in both… for music volume control option also needed"
#
# Same password, same server check. Photos are turned into the album's own
# three tiers HERE (Pillow, already installed as fpdf2's dependency): the
# camera's rotation is baked in and every other EXIF field — GPS included — is
# dropped, exactly as the album build script did.

PHOTO_MAX = 25 * 1024 * 1024
SONG_MAX = 20 * 1024 * 1024
SONG_TYPES = {
    "audio/mpeg": ("mp3", "audio/mpeg"),
    "audio/mp3": ("mp3", "audio/mpeg"),
    "audio/mp4": ("m4a", "audio/mp4"),
    "audio/x-m4a": ("m4a", "audio/mp4"),
    "audio/ogg": ("ogg", "audio/ogg"),
}


def _read_json(name: str, default: object) -> object:
    try:
        return json.loads(get_storage().read(PREFIX + name))
    except (FileNotFoundError, ValueError):
        return default


def _taken(pid: str) -> bool:
    """A removed photo keeps its files, and browsers keep them for a day, so
    its id is never handed out again: the new photo would show up as the old
    one. Any read error counts as free (S3 says AccessDenied, not NoSuchKey,
    for a missing key when the role cannot list the bucket)."""
    try:
        get_storage().read(f"{PREFIX}thumb/{pid}.webp")
        return True
    except Exception:
        return False


def _tiers(raw: bytes) -> tuple[bytes, bytes, dict]:
    """(full, thumb, manifest fields) for one uploaded photo."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(raw)) as src:
        im = ImageOps.exif_transpose(src).convert("RGB")

    def webp(side: int, quality: int) -> tuple[bytes, int, int]:
        copy = im.copy()
        copy.thumbnail((side, side), Image.LANCZOS)
        out = io.BytesIO()
        copy.save(out, "WEBP", quality=quality, method=6)  # no exif=: nothing carried over
        return out.getvalue(), copy.width, copy.height

    full, fw, fh = webp(1800, 82)
    thumb, _, _ = webp(720, 78)
    tiny, _, _ = webp(24, 50)
    lqip = "data:image/webp;base64," + base64.b64encode(tiny).decode()
    return full, thumb, {"w": fw, "h": fh, "ratio": round(fw / fh, 4), "lqip": lqip}


@router.post("/photos")
async def upload_photos(
    request: Request,
    password: str = Form(..., max_length=200),
    files: list[UploadFile] = File(...),
) -> dict:
    if not enabled():
        raise HTTPException(404, "Not found")
    await run_in_threadpool(_authorise, request, password)
    if not files or len(files) > 20:
        raise HTTPException(422, "Send between 1 and 20 photos at a time.")
    album = list(await run_in_threadpool(_read_json, "album.json", []))
    used = {int(p["id"][1:]) for p in album if re.fullmatch(r"p\d{2,3}", str(p.get("id", "")))}
    nxt = max(used, default=-1) + 1
    store = get_storage()
    added = []
    for f in files:
        raw = await f.read(PHOTO_MAX + 1)
        if len(raw) > PHOTO_MAX:
            raise HTTPException(413, f"{f.filename}: larger than 25 MB.")
        try:
            full, thumb, meta = await run_in_threadpool(_tiers, raw)
        except Exception:
            raise HTTPException(422, f"{f.filename}: not a photo we can read.") from None
        while nxt <= 999 and await run_in_threadpool(_taken, f"p{nxt:02d}"):
            nxt += 1
        if nxt > 999:
            raise HTTPException(422, "The album is full.")
        pid = f"p{nxt:02d}"
        nxt += 1
        await run_in_threadpool(store.write, f"{PREFIX}full/{pid}.webp", full, "image/webp")
        await run_in_threadpool(store.write, f"{PREFIX}thumb/{pid}.webp", thumb, "image/webp")
        entry = {"id": pid, **meta}
        album.append(entry)
        added.append(entry)
    await run_in_threadpool(_write, "album.json", album)
    return {"ok": True, "added": added, "album": album}


class RemovePhoto(Unlock):
    id: str = Field(pattern=r"^p\d{2,3}$")


@router.post("/photos/remove")
async def remove_photo(body: RemovePhoto, request: Request) -> dict:
    if not enabled():
        raise HTTPException(404, "Not found")
    await run_in_threadpool(_authorise, request, body.password)
    current = await run_in_threadpool(_read_json, "album.json", [])
    album = [p for p in current if p.get("id") != body.id]
    await run_in_threadpool(_write, "album.json", album)
    return {"ok": True, "album": album}


class Track(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]{1,48}$")
    title: str = Field(min_length=1, max_length=80)
    file: str = Field(pattern=r"^[a-z0-9-]{1,48}\.(mp3|m4a|ogg)$")
    scope: Literal["landing", "album", "both"]


class SaveMusic(Unlock):
    tracks: list[Track] = Field(max_length=40)
    volume: float = Field(ge=0, le=1)


@router.put("/music")
async def save_music(body: SaveMusic, request: Request) -> dict:
    """Order, titles, where each song plays, and the default volume."""
    if not enabled():
        raise HTTPException(404, "Not found")
    await run_in_threadpool(_authorise, request, body.password)
    current = await run_in_threadpool(_read_json, "music.json", {})
    known = {t["file"] for t in current.get("tracks", [])} if isinstance(current, dict) else set()
    if any(t.file not in known for t in body.tracks):
        raise HTTPException(422, "A song in the list was never uploaded.")
    manifest = {"tracks": [t.model_dump() for t in body.tracks], "volume": round(body.volume, 2)}
    await run_in_threadpool(_write, "music.json", manifest)
    return {"ok": True, "music": manifest}


@router.post("/music")
async def upload_song(
    request: Request,
    password: str = Form(..., max_length=200),
    title: str = Form(..., min_length=1, max_length=80),
    scope: Literal["landing", "album", "both"] = Form("both"),
    file: UploadFile = File(...),
) -> dict:
    if not enabled():
        raise HTTPException(404, "Not found")
    await run_in_threadpool(_authorise, request, password)
    kind = SONG_TYPES.get((file.content_type or "").lower())
    if not kind:
        raise HTTPException(415, "Upload an MP3, M4A or OGG file.")
    raw = await file.read(SONG_MAX + 1)
    if len(raw) > SONG_MAX:
        raise HTTPException(413, "Songs must be under 20 MB.")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:30] or "song"
    tid = f"{slug}-{secrets.token_hex(3)}"
    name = f"{tid}.{kind[0]}"
    await run_in_threadpool(get_storage().write, f"{PREFIX}music/{name}", raw, kind[1])
    manifest = await run_in_threadpool(_read_json, "music.json", {})
    if not isinstance(manifest, dict):
        manifest = {}
    entry = {"id": tid, "title": title.strip(), "file": name, "scope": scope}
    manifest.setdefault("tracks", []).append(entry)
    manifest.setdefault("volume", 0.6)
    await run_in_threadpool(_write, "music.json", manifest)
    return {"ok": True, "music": manifest}


# ── His résumé, replaced from the owner panel ───────────────────────────────
#
#   "so many things we made customisable using the password… so why can't
#    résumé updation… if I need, I can replace it with an updated résumé"
#
# The same build as dev/scripts/publish_resume.py, done here on upload: the
# PDF and (optionally) the Word file under their one clean name, every page as
# a lossless WebP for the in-place viewer, a small cover, and resume.json with
# a version (a hash of the PDF) that the page puts on every URL, so the new
# résumé is never hidden behind a cached old one. Pages are drawn with PDFium
# (pypdfium2, BSD/Apache) — the script's PyMuPDF is AGPL, not for a server.
#
# A Word file is optional; without one the Word download is dropped rather
# than left offering the OLD résumé.

RESUME_NAME = "Pandian_Sambath_Resume"
RESUME_MAX = 10 * 1024 * 1024
RESUME_PAGES = 6
RESUME_PAGE_W = 1800  # sharp on a 2x phone and in a ~900 px desktop viewer
RESUME_THUMB_W = 360  # the card shows the cover ~95 px wide


def _resume_pages(pdf: bytes) -> tuple[list[tuple[str, bytes, dict]], tuple[bytes, dict]]:
    """[(name, webp, {src, w, h}) per page], (thumb webp, {src, w, h})."""
    import pypdfium2 as pdfium
    from PIL import Image

    doc = pdfium.PdfDocument(pdf)
    try:
        n = len(doc)
        if not 1 <= n <= RESUME_PAGES:
            raise ValueError(f"{n} pages")
        pages: list[tuple[str, bytes, dict]] = []
        thumb: tuple[bytes, dict] | None = None
        for i in range(n):
            page = doc[i]
            width_pt = page.get_width()
            img = page.render(scale=RESUME_PAGE_W / width_pt).to_pil().convert("RGB")
            # A page of text is flat colour and sharp edges: lossless WebP packs
            # it smaller than lossy, with no smudge round the letters.
            out = io.BytesIO()
            img.save(out, "WEBP", lossless=True, quality=100, method=4)
            name = f"page-{i + 1}.webp"
            pages.append((name, out.getvalue(), {"src": name, "w": img.width, "h": img.height}))
            if i == 0:
                cover = img.copy()
                cover.thumbnail((RESUME_THUMB_W, RESUME_THUMB_W * 4), Image.LANCZOS)
                tout = io.BytesIO()
                cover.save(tout, "WEBP", quality=72, method=6)
                meta = {"src": "thumb.webp", "w": cover.width, "h": cover.height}
                thumb = (tout.getvalue(), meta)
            page.close()
        assert thumb is not None
        return pages, thumb
    finally:
        doc.close()


@router.post("/resume")
async def upload_resume(
    request: Request,
    password: str = Form(..., max_length=200),
    pdf: UploadFile = File(...),
    docx: UploadFile | None = File(None),
) -> dict:
    if not enabled():
        raise HTTPException(404, "Not found")
    await run_in_threadpool(_authorise, request, password)
    raw = await pdf.read(RESUME_MAX + 1)
    if len(raw) > RESUME_MAX:
        raise HTTPException(413, "The PDF must be under 10 MB.")
    if not raw.startswith(b"%PDF"):
        raise HTTPException(415, "Upload the résumé as a PDF.")
    word: bytes | None = None
    if docx is not None and docx.filename:
        word = await docx.read(RESUME_MAX + 1)
        if len(word) > RESUME_MAX:
            raise HTTPException(413, "The Word file must be under 10 MB.")
        if not word.startswith(b"PK\x03\x04"):
            raise HTTPException(415, "The Word file must be a .docx.")
    try:
        pages, (thumb, thumb_meta) = await run_in_threadpool(_resume_pages, raw)
    except Exception:
        raise HTTPException(
            422, f"That PDF could not be read, or it has more than {RESUME_PAGES} pages."
        ) from None

    store = get_storage()
    before = await run_in_threadpool(_read_json, "resume/resume.json", {})
    old_pages = len(before.get("pages", [])) if isinstance(before, dict) else 0
    base = f"{PREFIX}resume/"
    await run_in_threadpool(store.write, f"{base}{RESUME_NAME}.pdf", raw, "application/pdf")
    if word is not None:
        await run_in_threadpool(store.write, f"{base}{RESUME_NAME}.docx", word, _TYPES[".docx"])
    for name, data, _meta in pages:
        await run_in_threadpool(store.write, f"{base}{name}", data, "image/webp")
    await run_in_threadpool(store.write, f"{base}thumb.webp", thumb, "image/webp")
    # A shorter résumé leaves no stray pages behind.
    for i in range(len(pages) + 1, max(old_pages, RESUME_PAGES) + 1):
        try:
            await run_in_threadpool(store.delete, f"{base}page-{i}.webp")
        except Exception:
            pass
    manifest = {
        "version": hashlib.sha256(raw).hexdigest()[:12],
        "updated": date.today().isoformat(),
        "pdf": f"{RESUME_NAME}.pdf",
        "docx": f"{RESUME_NAME}.docx" if word is not None else None,
        "pdfKB": round(len(raw) / 1024),
        "docxKB": round(len(word) / 1024) if word is not None else None,
        "thumb": thumb_meta,
        "pages": [meta for _name, _data, meta in pages],
    }
    await run_in_threadpool(_write, "resume/resume.json", manifest)
    return {"ok": True, "resume": manifest}


# HEAD as well as GET: link previews and download managers ask with HEAD
# first, and were getting 405 for a file that exists.
@router.api_route("/{path:path}", methods=["GET", "HEAD"])
async def dev_site_file(path: str, download: bool = False) -> Response:
    if not enabled() or not _ALLOWED.match(path):
        raise HTTPException(404, "Not found")
    try:
        # boto3 blocks; keep it off the event loop.
        data = await run_in_threadpool(get_storage().read, PREFIX + path)
    except FileNotFoundError:
        raise HTTPException(404, "Not found") from None
    ext = path[path.rfind(".") :]
    name = path.rsplit("/", 1)[-1]
    if download or ext == ".docx":
        # Saved under its own name. A browser cannot show a Word file anyway,
        # and `?download=1` is what the Download buttons ask for.
        disposition = {"Content-Disposition": f'attachment; filename="{name}"'}
    elif ext == ".pdf":
        # Shown in the browser, not downloaded, when a PDF is opened.
        disposition = {"Content-Disposition": "inline"}
    else:
        disposition = {}
    # A day for the album pictures (a rebuild reuses p00, p01…); five minutes
    # for the manifests and the résumé, which keep their names when he
    # republishes, so a new version shows up quickly.
    short = ext == ".json" or path.startswith("resume/")
    # His own edits must show the moment he saves them.
    edited = path in (
        "milestones.json",
        "site.json",
        "music.json",
        "album.json",
        "resume/resume.json",
    )
    cache = "no-store" if edited else "public, max-age=300" if short else "public, max-age=86400"
    return Response(
        content=data,
        media_type=_TYPES[ext],
        headers={
            "Cache-Control": cache,
            **disposition,
        },
    )
