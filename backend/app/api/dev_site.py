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
import os
import re

from fastapi import APIRouter, HTTPException, Response
from starlette.concurrency import run_in_threadpool

from app.core.storage import get_storage

router = APIRouter(prefix="/dev-site", tags=["dev-site"])

PREFIX = "dev-site/"

# The ONLY names that can be read. Anything else is a 404, which also rules
# out "../" and every other key in the bucket.
_ALLOWED = re.compile(
    r"^(?:(?:full|thumb)/p\d{2,3}\.webp"
    r"|profile(?:-alt)?\.webp"
    r"|RANK_AFF_UG_2023\.pdf"
    r"|album\.json)$"
)

_TYPES = {".webp": "image/webp", ".pdf": "application/pdf", ".json": "application/json"}


def enabled() -> bool:
    """Same rule as the page itself (frontend/app/dev/page.tsx)."""
    raw = (os.environ.get("DEV_PROFILE_ENABLED") or "1").strip().lower()
    return raw not in {"0", "false", "off", "no"}


@router.get("/{path:path}")
async def dev_site_file(path: str) -> Response:
    if not enabled() or not _ALLOWED.match(path):
        raise HTTPException(404, "Not found")
    try:
        # boto3 blocks; keep it off the event loop.
        data = await run_in_threadpool(get_storage().read, PREFIX + path)
    except FileNotFoundError:
        raise HTTPException(404, "Not found") from None
    ext = path[path.rfind(".") :]
    return Response(
        content=data,
        media_type=_TYPES[ext],
        headers={
            # A day for the pictures (a rebuild of the album reuses p00, p01…);
            # five minutes for the manifest, so a rebuild shows up quickly.
            "Cache-Control": "public, max-age=300" if ext == ".json" else "public, max-age=86400",
            # Shown in the browser, not downloaded, when the rank list is opened.
            **({"Content-Disposition": "inline"} if ext == ".pdf" else {}),
        },
    )
