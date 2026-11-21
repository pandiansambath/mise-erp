"""His personal files come out of private storage through one narrow door.

    "go remove my personal stuff like photo and resume...store in s3..from s3
     u can serve them instead of direct codebase"

They used to be committed to a public repository. Now they live under
`dev-site/` in the private uploads bucket, and this route is the only way to
them: an exact list of names, nothing else in the bucket, and dark when the
profile page is switched off.
"""
from pathlib import Path

import pytest

from app.core.config import settings

FILES = {
    "thumb/p00.webp": b"RIFF-thumb",
    "full/p00.webp": b"RIFF-full",
    "profile.webp": b"RIFF-profile",
    "RANK_AFF_UG_2023.pdf": b"%PDF-1.4",
    "album.json": b'[{"id": "p00"}]',
    "resume/Pandian_Sambath_Resume.pdf": b"%PDF-1.7 resume",
    "resume/Pandian_Sambath_Resume.docx": b"PK\x03\x04 resume",
    "resume/page-1.webp": b"RIFF-page-1",
    "resume/thumb.webp": b"RIFF-cover",
    "resume/resume.json": b'{"version": "abc123"}',
}

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@pytest.fixture
def stored():
    """The files where the LOCAL storage backend looks for them."""
    base = Path(settings.upload_dir) / "dev-site"
    for name, data in FILES.items():
        target = base / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    # Something else in the bucket that must never be reachable this way.
    (Path(settings.upload_dir) / "private.txt").write_bytes(b"secret")
    yield
    for name in FILES:
        (base / name).unlink(missing_ok=True)
    (Path(settings.upload_dir) / "private.txt").unlink(missing_ok=True)


async def test_the_listed_files_are_served_with_their_type(client, stored, monkeypatch) -> None:
    monkeypatch.delenv("DEV_PROFILE_ENABLED", raising=False)
    expect = {
        "thumb/p00.webp": "image/webp",
        "full/p00.webp": "image/webp",
        "profile.webp": "image/webp",
        "RANK_AFF_UG_2023.pdf": "application/pdf",
        "album.json": "application/json",
        "resume/Pandian_Sambath_Resume.pdf": "application/pdf",
        "resume/Pandian_Sambath_Resume.docx": DOCX,
        "resume/page-1.webp": "image/webp",
        "resume/thumb.webp": "image/webp",
        "resume/resume.json": "application/json",
    }
    for name, kind in expect.items():
        r = await client.get(f"/api/dev-site/{name}")
        assert r.status_code == 200, (name, r.status_code)
        assert r.headers["content-type"].startswith(kind), name
        assert r.content == FILES[name]
        assert "max-age" in r.headers["cache-control"]


async def test_nothing_else_in_the_bucket_is_reachable(client, stored, monkeypatch) -> None:
    monkeypatch.delenv("DEV_PROFILE_ENABLED", raising=False)
    for name in (
        "../private.txt",
        "..%2Fprivate.txt",
        "thumb/../../private.txt",
        "private.txt",
        "thumb/p00.jpg",
        "full/secret.webp",
        "resume.docx",
        "resume/../private.txt",
        "resume/other.pdf",
        "resume/page-1.png",
        "resume/notes.json",
        "",
    ):
        r = await client.get(f"/api/dev-site/{name}")
        assert r.status_code == 404, (name, r.status_code)
        assert b"secret" not in r.content


async def test_the_resume_opens_in_place_and_downloads_under_its_name(client, stored, monkeypatch) -> None:
    """View shows the PDF in the browser; the Download buttons save the file
    as Pandian_Sambath_Resume.pdf / .docx, not as "resume.json?v=…"."""
    monkeypatch.delenv("DEV_PROFILE_ENABLED", raising=False)
    pdf = "/api/dev-site/resume/Pandian_Sambath_Resume.pdf"
    assert (await client.get(pdf)).headers["content-disposition"] == "inline"
    r = await client.get(pdf + "?download=1&v=abc123")
    assert r.headers["content-disposition"] == 'attachment; filename="Pandian_Sambath_Resume.pdf"'
    # A browser cannot show Word, so the .docx always arrives as a download.
    r = await client.get("/api/dev-site/resume/Pandian_Sambath_Resume.docx")
    assert r.headers["content-disposition"] == 'attachment; filename="Pandian_Sambath_Resume.docx"'
    # It keeps its name when he republishes, so it must not be cached for a day.
    assert r.headers["cache-control"] == "public, max-age=300"


async def test_a_missing_file_is_a_404_not_a_500(client, monkeypatch) -> None:
    monkeypatch.delenv("DEV_PROFILE_ENABLED", raising=False)
    r = await client.get("/api/dev-site/thumb/p99.webp")
    assert r.status_code == 404


async def test_switching_the_page_off_hides_the_photos_too(client, stored, monkeypatch) -> None:
    """A page that is off must not leave its photos one URL away."""
    for off in ("0", "false", "off", "no"):
        monkeypatch.setenv("DEV_PROFILE_ENABLED", off)
        r = await client.get("/api/dev-site/thumb/p00.webp")
        assert r.status_code == 404, off
    monkeypatch.setenv("DEV_PROFILE_ENABLED", "1")
    assert (await client.get("/api/dev-site/thumb/p00.webp")).status_code == 200
