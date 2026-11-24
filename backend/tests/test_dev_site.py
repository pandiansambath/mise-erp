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
        # The album's and the résumé's manifests change the moment he uploads,
        # so they are never cached; the photos and files themselves are.
        want = "no-store" if name in ("album.json", "resume/resume.json") else "max-age"
        assert want in r.headers["cache-control"], name


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
    # Link previews and download managers ask with HEAD first.
    r = await client.head("/api/dev-site/resume/Pandian_Sambath_Resume.docx")
    assert r.status_code == 200
    assert r.headers["content-disposition"] == 'attachment; filename="Pandian_Sambath_Resume.docx"'


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


# ── His edits: the password is checked on the server, against a hash only ─────

import bcrypt  # noqa: E402

from app.api import dev_site as dev_site_api  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture
def editor_hash(monkeypatch):
    monkeypatch.delenv("DEV_PROFILE_ENABLED", raising=False)
    dev_site_api._FAILS.clear()
    target = Path(settings.upload_dir) / "dev-site" / "private" / "editor.hash"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(4)))
    yield
    target.unlink(missing_ok=True)
    for name in ("milestones.json", "site.json"):
        (Path(settings.upload_dir) / "dev-site" / name).unlink(missing_ok=True)
    dev_site_api._FAILS.clear()


async def test_nobody_can_edit_until_a_hash_exists(client, monkeypatch) -> None:
    monkeypatch.delenv("DEV_PROFILE_ENABLED", raising=False)
    (Path(settings.upload_dir) / "dev-site" / "private" / "editor.hash").unlink(missing_ok=True)
    r = await client.post("/api/dev-site/unlock", json={"password": "anything"})
    assert r.status_code == 503


async def test_wrong_password_is_refused_and_right_one_saves(client, editor_hash) -> None:
    assert (await client.post("/api/dev-site/unlock", json={"password": "nope"})).status_code == 401
    assert (await client.post("/api/dev-site/unlock", json={"password": PASSWORD})).status_code == 200

    entry = {"when": "Feb 2026", "kind": "recognition", "title": "Spot award"}
    r = await client.put("/api/dev-site/milestones", json={"password": "nope", "milestones": [entry]})
    assert r.status_code == 401
    r = await client.put("/api/dev-site/milestones", json={"password": PASSWORD, "milestones": [entry]})
    assert r.status_code == 200

    saved = await client.get("/api/dev-site/milestones.json")
    assert saved.status_code == 200
    assert saved.json()[0]["title"] == "Spot award"
    assert saved.headers["cache-control"] == "no-store"

    r = await client.put("/api/dev-site/site", json={"password": PASSWORD, "theme": "aurora", "design": "metro"})
    assert r.status_code == 200
    assert (await client.get("/api/dev-site/site.json")).json() == {"theme": "aurora", "design": "metro"}


async def test_bad_entries_are_rejected(client, editor_hash) -> None:
    for bad in (
        {"when": "Smarch 2026", "kind": "recognition", "title": "x"},
        {"when": "Feb 2026", "kind": "hacked", "title": "x"},
        {"when": "Feb 2026", "kind": "note", "title": ""},
    ):
        r = await client.put("/api/dev-site/milestones", json={"password": PASSWORD, "milestones": [bad]})
        assert r.status_code == 422, bad


async def test_the_hash_itself_is_never_served(client, editor_hash) -> None:
    for name in ("private/editor.hash", "private/../private/editor.hash"):
        assert (await client.get(f"/api/dev-site/{name}")).status_code == 404


async def test_guessing_stops_after_a_handful(client, editor_hash) -> None:
    for _ in range(dev_site_api.FAIL_LIMIT):
        assert (await client.post("/api/dev-site/unlock", json={"password": "guess"})).status_code == 401
    # Locked out — even the right password waits.
    assert (await client.post("/api/dev-site/unlock", json={"password": PASSWORD})).status_code == 429


# ── His uploads ──────────────────────────────────────────────────────────────


@pytest.fixture
def uploads(editor_hash):
    base = Path(settings.upload_dir) / "dev-site"
    before = {p for p in base.rglob("*") if p.is_file()} if base.exists() else set()
    for name in ("album.json", "music.json"):
        (base / name).unlink(missing_ok=True)
    yield base
    for p in base.rglob("*"):
        if p.is_file() and p not in before:
            p.unlink(missing_ok=True)
    for name in ("album.json", "music.json"):
        (base / name).unlink(missing_ok=True)


def _photo_with_gps() -> bytes:
    from io import BytesIO

    from PIL import Image

    im = Image.new("RGB", (2400, 1600), (200, 120, 40))
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (13.0, 4.0, 0.0)}  # GPS block: where he was standing
    exif[0x0110] = "Phone"
    out = BytesIO()
    im.save(out, "JPEG", exif=exif)
    return out.getvalue()


async def test_photos_lose_their_location_and_ids_are_never_reused(client, uploads) -> None:
    from io import BytesIO

    from PIL import Image

    jpg = _photo_with_gps()
    assert b"Exif" in jpg
    files = [("files", ("beach.jpg", jpg, "image/jpeg"))]
    r = await client.post("/api/dev-site/photos", data={"password": "nope"}, files=files)
    assert r.status_code == 401

    r = await client.post("/api/dev-site/photos", data={"password": PASSWORD}, files=files)
    assert r.status_code == 200, r.text
    first = r.json()["added"][0]
    assert first["w"] == 1800 and first["h"] == 1200
    assert first["lqip"].startswith("data:image/webp;base64,")

    full = await client.get(f"/api/dev-site/full/{first['id']}.webp")
    assert full.status_code == 200
    with Image.open(BytesIO(full.content)) as im:
        assert im.size == (1800, 1200)
        assert not im.getexif()
    assert b"Exif" not in full.content

    r = await client.post("/api/dev-site/photos/remove", json={"password": PASSWORD, "id": first["id"]})
    assert r.status_code == 200
    assert r.json()["album"] == []

    # The removed photo's files may still sit in visitors' caches for a day.
    r = await client.post("/api/dev-site/photos", data={"password": PASSWORD}, files=files)
    assert r.json()["added"][0]["id"] != first["id"]

    bad = [("files", ("notes.jpg", b"not a picture", "image/jpeg"))]
    r = await client.post("/api/dev-site/photos", data={"password": PASSWORD}, files=bad)
    assert r.status_code == 422


async def test_songs_upload_reorder_and_refuse_strangers(client, uploads) -> None:
    song = b"ID3" + b"\x00" * 2048
    r = await client.post(
        "/api/dev-site/music",
        data={"password": PASSWORD, "title": "Evening Raga", "scope": "album"},
        files={"file": ("x.exe", b"MZ", "application/octet-stream")},
    )
    assert r.status_code == 415

    r = await client.post(
        "/api/dev-site/music",
        data={"password": PASSWORD, "title": "Evening Raga", "scope": "album"},
        files={"file": ("raga.mp3", song, "audio/mpeg")},
    )
    assert r.status_code == 200, r.text
    track = r.json()["music"]["tracks"][0]
    assert track["file"].startswith("evening-raga-") and track["file"].endswith(".mp3")
    assert track["scope"] == "album"

    served = await client.get(f"/api/dev-site/music/{track['file']}")
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("audio/mpeg")
    manifest = await client.get("/api/dev-site/music.json")
    assert manifest.headers["cache-control"] == "no-store"

    stranger = {**track, "id": "ghost", "file": "ghost-000000.mp3"}
    r = await client.put("/api/dev-site/music", json={"password": PASSWORD, "tracks": [track, stranger], "volume": 0.5})
    assert r.status_code == 422

    r = await client.put(
        "/api/dev-site/music",
        json={"password": PASSWORD, "tracks": [{**track, "scope": "both"}], "volume": 0.45},
    )
    assert r.status_code == 200
    assert (await client.get("/api/dev-site/music.json")).json() == {
        "tracks": [{**track, "scope": "both"}],
        "volume": 0.45,
    }

    # How it begins: his choice, kept by a save that says nothing of it, and by a new song.
    put = {"password": PASSWORD, "tracks": [track], "volume": 0.45}
    r = await client.put("/api/dev-site/music", json={**put, "start": "button"})
    assert r.status_code == 200 and r.json()["music"]["start"] == "button"
    r = await client.put("/api/dev-site/music", json=put)
    assert r.json()["music"]["start"] == "button"
    r = await client.post(
        "/api/dev-site/music",
        data={"password": PASSWORD, "title": "Second", "scope": "both"},
        files={"file": ("b.mp3", song, "audio/mpeg")},
    )
    assert r.json()["music"]["start"] == "button"
    r = await client.put("/api/dev-site/music", json={**put, "start": "whenever"})
    assert r.status_code == 422


# ── His résumé, replaced from the owner panel ───────────────────────────────


def _resume_pdf(pages: int) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4")
    for i in range(pages):
        pdf.add_page()
        pdf.set_font("Helvetica", size=20)
        pdf.cell(0, 20, f"Pandian Sambath, page {i + 1}")
    return bytes(pdf.output())


async def test_the_resume_is_replaced_with_its_pages_drawn(client, uploads) -> None:
    """ "if I need, I can replace it with an updated résumé" """
    from io import BytesIO

    from PIL import Image

    base = Path(settings.upload_dir) / "dev-site" / "resume"
    two = _resume_pdf(2)
    files = {"pdf": ("new.pdf", two, "application/pdf")}

    # The password, as for every other edit.
    r = await client.post("/api/dev-site/resume", data={"password": "nope"}, files=files)
    assert r.status_code == 401

    # A Word file goes with it the first time.
    word = b"PK\x03\x04" + b"\x00" * 600
    r = await client.post(
        "/api/dev-site/resume",
        data={"password": PASSWORD},
        files={"pdf": ("new.pdf", two, "application/pdf"), "docx": ("new.docx", word, DOCX)},
    )
    assert r.status_code == 200, r.text
    m = r.json()["resume"]
    assert len(m["pages"]) == 2 and m["pages"][0]["w"] == 1800
    assert m["docx"] == "Pandian_Sambath_Resume.docx" and m["docxKB"] == 1
    assert m["thumb"]["w"] == 360 and len(m["version"]) == 12

    page = await client.get("/api/dev-site/resume/page-2.webp")
    assert page.status_code == 200
    with Image.open(BytesIO(page.content)) as im:
        assert im.format == "WEBP" and im.width == 1800
    pdf = await client.get("/api/dev-site/resume/Pandian_Sambath_Resume.pdf")
    assert pdf.content == two
    # The manifest shows his new résumé the moment he saves it.
    manifest = await client.get("/api/dev-site/resume/resume.json")
    assert manifest.headers["cache-control"] == "no-store"
    assert manifest.json()["version"] == m["version"]

    # A shorter one, without Word: the old second page and the old Word
    # download do not linger as if they were the new résumé.
    one = _resume_pdf(1)
    r = await client.post("/api/dev-site/resume", data={"password": PASSWORD}, files={"pdf": ("one.pdf", one, "application/pdf")})
    assert r.status_code == 200, r.text
    m2 = r.json()["resume"]
    assert len(m2["pages"]) == 1 and m2["docx"] is None and m2["docxKB"] is None
    assert m2["version"] != m["version"]
    assert not (base / "page-2.webp").exists()

    # Not a PDF, or not a résumé-sized one.
    r = await client.post("/api/dev-site/resume", data={"password": PASSWORD}, files={"pdf": ("x.pdf", b"MZ not a pdf", "application/pdf")})
    assert r.status_code == 415
    r = await client.post("/api/dev-site/resume", data={"password": PASSWORD}, files={"pdf": ("x.pdf", b"%PDF-1.4 broken", "application/pdf")})
    assert r.status_code == 422
    r = await client.post("/api/dev-site/resume", data={"password": PASSWORD}, files={"pdf": ("long.pdf", _resume_pdf(7), "application/pdf")})
    assert r.status_code == 422
    r = await client.post(
        "/api/dev-site/resume",
        data={"password": PASSWORD},
        files={"pdf": ("one.pdf", one, "application/pdf"), "docx": ("x.docx", b"not a docx", DOCX)},
    )
    assert r.status_code == 415


# ── His portrait: photos, order and pace ─────────────────────────────────────


async def test_his_words_for_the_site_save_and_reset(client, uploads) -> None:
    """ "the name and the font of that name… the slogan… the company… literally all
    texts… a single-click button to make all default" """
    body = {
        "password": PASSWORD,
        "texts": {"name": "Pandian S.", "company": "TCS", "slogan1": "Keep moving."},
        "style": {"nameFont": "sans", "nameColor": "gold"},
    }
    r = await client.put("/api/dev-site/texts", json={**body, "password": "nope"})
    assert r.status_code == 401
    r = await client.put("/api/dev-site/texts", json=body)
    assert r.status_code == 200, r.text
    served = await client.get("/api/dev-site/texts.json")
    assert served.headers["cache-control"] == "no-store"
    assert served.json() == {"texts": body["texts"], "style": body["style"]}
    # Every word of the page, some of them emptied (§103.7).
    many = {f"skill.k{i}.items": "a, b" for i in range(300)} | {"vol3Org": ""}
    r = await client.put("/api/dev-site/texts", json={"password": PASSWORD, "texts": many})
    assert r.status_code == 200
    assert (await client.get("/api/dev-site/texts.json")).json()["texts"] == many
    # Not a field the page has, far too long, or far too many: refused.
    too_many = {f"k{i}": "x" for i in range(481)}
    for bad in ({"texts": {"<script>": "x"}}, {"texts": {"name": "x" * 601}}, {"texts": too_many}):
        r = await client.put("/api/dev-site/texts", json={"password": PASSWORD, **bad})
        assert r.status_code == 422, bad
    # One click, every word back.
    r = await client.put("/api/dev-site/texts", json={"password": PASSWORD})
    assert r.status_code == 200
    assert (await client.get("/api/dev-site/texts.json")).json() == {"texts": {}, "style": {}}


async def test_his_skills_round_the_photo(client, uploads) -> None:
    """§102.6: "I need one feature to customise the skills which are rotating round
    my photo… in the Template itself… I can remove any skill, add any skill"""
    skills = [{"name": "Claude", "pin": True}, {"name": "Kubernetes", "pin": False}, {"name": "Go"}]
    r = await client.put("/api/dev-site/texts", json={"password": PASSWORD, "skills": skills})
    assert r.status_code == 200, r.text
    served = (await client.get("/api/dev-site/texts.json")).json()
    assert served["skills"] == [
        {"name": "Claude", "pin": True},
        {"name": "Kubernetes", "pin": False},
        {"name": "Go", "pin": False},
    ]
    # An empty list is his choice too (nothing going round).
    r = await client.put("/api/dev-site/texts", json={"password": PASSWORD, "skills": []})
    assert r.status_code == 200
    assert (await client.get("/api/dev-site/texts.json")).json()["skills"] == []
    # Markup, control characters, stray spaces, a name too long, the same skill
    # twice, far too many: refused.
    for bad in (
        [{"name": "<b>x</b>"}],
        [{"name": "a\u0007b"}],
        [{"name": " Go"}],
        [{"name": "x" * 25}],
        [{"name": "Go"}, {"name": "go"}],
        [{"name": f"s{i}"} for i in range(81)],
    ):
        r = await client.put("/api/dev-site/texts", json={"password": PASSWORD, "skills": bad})
        assert r.status_code == 422, bad
    # Saved without a list: the résumé's again (no "skills" kept).
    r = await client.put("/api/dev-site/texts", json={"password": PASSWORD, "texts": {"name": "P"}})
    assert r.status_code == 200
    assert "skills" not in (await client.get("/api/dev-site/texts.json")).json()


async def test_the_portrait_keeps_his_default_look(client, uploads) -> None:
    """ "different kinds of views… the photo can adapt… the colour and grading":
    his default look is saved with the portrait, kept when left out, and only
    the looks the site knows are taken."""
    order = [{"id": "profile", "file": "profile.webp"}]
    body = {"password": PASSWORD, "photos": order, "interval": 30}
    r = await client.put("/api/dev-site/portrait", json={**body, "look": "aura"})
    assert r.status_code == 200, r.text
    assert (await client.get("/api/dev-site/portrait.json")).json()["look"] == "aura"
    # Saved again without a look: the one he chose stays.
    r = await client.put("/api/dev-site/portrait", json={**body, "interval": 40})
    assert r.status_code == 200, r.text
    saved = (await client.get("/api/dev-site/portrait.json")).json()
    assert saved["look"] == "aura" and saved["interval"] == 40
    r = await client.put("/api/dev-site/portrait", json={**body, "look": "sepia"})
    assert r.status_code == 422


async def test_the_portrait_photos_upload_reorder_and_keep_their_pace(client, uploads) -> None:
    """ "I can change photo, add photos, edit time interval" """
    import re
    from io import BytesIO

    from PIL import Image

    files = [("files", ("me.jpg", _photo_with_gps(), "image/jpeg"))]
    r = await client.post("/api/dev-site/portrait", data={"password": "nope"}, files=files)
    assert r.status_code == 401

    r = await client.post("/api/dev-site/portrait", data={"password": PASSWORD}, files=files)
    assert r.status_code == 200, r.text
    m = r.json()["portrait"]
    # The two photos the site always had stay first until he reorders.
    assert [p["file"] for p in m["photos"][:2]] == ["profile.webp", "profile-alt.webp"]
    new = m["photos"][-1]
    assert re.fullmatch(r"portrait/pt-[a-f0-9]{6}\.webp", new["file"])

    served = await client.get(f"/api/dev-site/{new['file']}")
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("image/webp")
    with Image.open(BytesIO(served.content)) as im:
        assert max(im.size) == 1200
        assert not im.getexif()
    assert b"Exif" not in served.content

    # His order: the new photo first, the alt photo dropped, 20 s each.
    order = [new, m["photos"][0]]
    r = await client.put("/api/dev-site/portrait", json={"password": PASSWORD, "photos": order, "interval": 20})
    assert r.status_code == 200, r.text
    saved = await client.get("/api/dev-site/portrait.json")
    assert saved.headers["cache-control"] == "no-store"
    assert saved.json() == {"photos": order, "interval": 20}

    # Never uploaded, too fast, or nothing at all: refused.
    ghost = {"id": "pt-abcdef", "file": "portrait/pt-abcdef.webp"}
    for bad in (
        {"photos": [ghost], "interval": 20},
        {"photos": order, "interval": 1},
        {"photos": [], "interval": 20},
    ):
        r = await client.put("/api/dev-site/portrait", json={"password": PASSWORD, **bad})
        assert r.status_code == 422, bad
    r = await client.put("/api/dev-site/portrait", json={"password": "nope", "photos": order, "interval": 20})
    assert r.status_code == 401
