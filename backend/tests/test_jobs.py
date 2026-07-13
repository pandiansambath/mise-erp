"""Job portal: hotel posts -> public board lists -> public applies (resume)
-> hotel works the pipeline -> platform moderates."""
import io

import pytest

from app.auth.models import Role


async def _post_job(client, headers, **over):
    body = {
        "title": "Tandoor Chef",
        "department": "Kitchen",
        "employment_type": "FULL_TIME",
        "salary_text": "£13.50/hr",
        "description": "Run the tandoor section on service.",
        **over,
    }
    r = await client.post("/api/jobs", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_post_and_public_board(client, make_user, auth_header):
    mgr = await make_user("hiring@x.com", Role.MANAGER.value)
    h = auth_header(mgr)
    posting = await _post_job(client, h)
    assert posting["status"] == "OPEN"

    # the public board needs NO auth and shows the hotel's name
    board = await client.get("/api/public/jobs")
    assert board.status_code == 200
    rows = board.json()
    row = next(x for x in rows if x["id"] == posting["id"])
    assert row["hotel_name"]
    assert row["salary_text"] == "£13.50/hr"

    detail = await client.get(f"/api/public/jobs/{posting['id']}")
    assert detail.status_code == 200
    assert "tandoor" in detail.json()["description"].lower()


@pytest.mark.asyncio
async def test_apply_pipeline_and_resume(client, make_user, auth_header, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    mgr = await make_user("hiring2@x.com", Role.MANAGER.value)
    h = auth_header(mgr)
    posting = await _post_job(client, h, title="Waiter")

    # the public applies with a small PDF — no auth
    r = await client.post(
        f"/api/public/jobs/{posting['id']}/apply",
        data={
            "applicant_name": "Asha Kumar",
            "email": "Asha@Example.com",
            "phone": "07123 456789",
            "cover_note": "5 years front of house.",
        },
        files={"resume": ("asha-cv.pdf", io.BytesIO(b"%PDF-1.4 tiny"), "application/pdf")},
    )
    assert r.status_code == 201, r.text

    # a .exe is refused
    bad = await client.post(
        f"/api/public/jobs/{posting['id']}/apply",
        data={"applicant_name": "Mallory", "email": "m@x.com"},
        files={"resume": ("virus.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
    )
    assert bad.status_code == 422

    # the hotel sees the applicant (email normalised) + unread count
    postings = await client.get("/api/jobs", headers=h)
    row = next(p for p in postings.json() if p["id"] == posting["id"])
    assert row["applications"] == 1 and row["new_applications"] == 1

    apps = await client.get(f"/api/jobs/{posting['id']}/applications", headers=h)
    app_row = apps.json()[0]
    assert app_row["email"] == "asha@example.com"
    assert app_row["resume_filename"] == "asha-cv.pdf"

    # pipeline move + resume download
    moved = await client.patch(
        f"/api/jobs/applications/{app_row['id']}", json={"status": "SHORTLISTED"}, headers=h
    )
    assert moved.status_code == 200 and moved.json()["status"] == "SHORTLISTED"

    resume = await client.get(f"/api/jobs/applications/{app_row['id']}/resume", headers=h)
    assert resume.status_code == 200
    assert resume.content.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_closed_jobs_leave_the_board_and_platform_moderates(
    client, make_user, auth_header, db
):
    mgr = await make_user("hiring3@x.com", Role.MANAGER.value)
    h = auth_header(mgr)
    posting = await _post_job(client, h, title="Kitchen Porter")

    # hotel closes it -> gone from the public board, applying 404s
    closed = await client.patch(f"/api/jobs/{posting['id']}", json={"status": "CLOSED"}, headers=h)
    assert closed.status_code == 200
    board = await client.get("/api/public/jobs")
    assert all(x["id"] != posting["id"] for x in board.json())
    apply_r = await client.post(
        f"/api/public/jobs/{posting['id']}/apply",
        data={"applicant_name": "Late Larry", "email": "l@x.com"},
    )
    assert apply_r.status_code == 404

    # the platform operator sees it and can moderate it
    op = await make_user("op-jobs@mise.com", Role.SUPER_ADMIN.value)
    op.is_platform_owner = True
    await db.commit()
    all_jobs = await client.get("/api/platform/jobs", headers=auth_header(op))
    assert all_jobs.status_code == 200
    target = next(p for p in all_jobs.json()["postings"] if p["id"] == posting["id"])
    assert target["hotel_name"]

    reopened = await client.patch(
        f"/api/platform/jobs/{posting['id']}", json={"status": "OPEN"}, headers=auth_header(op)
    )
    assert reopened.status_code == 200 and reopened.json()["status"] == "OPEN"

    gone = await client.delete(f"/api/platform/jobs/{posting['id']}", headers=auth_header(op))
    assert gone.status_code == 204
