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
import json
import os
import re
import time
from collections import defaultdict, deque
from typing import Literal

import bcrypt
from fastapi import APIRouter, HTTPException, Request, Response
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
    r"|milestones\.json|site\.json"
    r"|resume/(?:Pandian_Sambath_Resume\.(?:pdf|docx)|page-\d{1,2}\.webp|thumb\.webp|resume\.json))$"
)

_TYPES = {
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
    edited = path in ("milestones.json", "site.json")
    cache = "no-store" if edited else "public, max-age=300" if short else "public, max-age=86400"
    return Response(
        content=data,
        media_type=_TYPES[ext],
        headers={
            "Cache-Control": cache,
            **disposition,
        },
    )
