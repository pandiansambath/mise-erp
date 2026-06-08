"""Document upload / download / expiry / RBAC tests."""
from datetime import date, timedelta

import pytest

from app.auth.models import Role

PDF = b"%PDF-1.4 fake content"


@pytest.mark.asyncio
async def test_upload_list_download(client, make_user, auth_header):
    mgr = await make_user("mgr@nirai.com", Role.MANAGER.value)
    h = auth_header(mgr)

    up = await client.post(
        "/api/documents",
        headers=h,
        files={"file": ("hygiene.pdf", PDF, "application/pdf")},
        data={"doc_type": "LICENSE", "title": "Food Hygiene Certificate"},
    )
    assert up.status_code == 201
    doc = up.json()
    assert doc["title"] == "Food Hygiene Certificate"
    assert doc["file_size"] == len(PDF)

    listed = await client.get("/api/documents", headers=h)
    assert any(d["id"] == doc["id"] for d in listed.json())

    dl = await client.get(f"/api/documents/{doc['id']}/download", headers=h)
    assert dl.status_code == 200
    assert dl.content == PDF


@pytest.mark.asyncio
async def test_expiring_documents(client, make_user, auth_header):
    mgr = await make_user("mgr@nirai.com", Role.MANAGER.value)
    h = auth_header(mgr)
    soon = (date.today() + timedelta(days=10)).isoformat()
    far = (date.today() + timedelta(days=200)).isoformat()
    await client.post("/api/documents", headers=h, files={"file": ("a.pdf", PDF, "application/pdf")},
                      data={"doc_type": "LICENSE", "title": "Expiring soon", "expiry_date": soon})
    await client.post("/api/documents", headers=h, files={"file": ("b.pdf", PDF, "application/pdf")},
                      data={"doc_type": "INSURANCE", "title": "Far away", "expiry_date": far})

    exp = await client.get("/api/documents/expiring?within_days=30", headers=h)
    titles = [d["title"] for d in exp.json()]
    assert "Expiring soon" in titles
    assert "Far away" not in titles


@pytest.mark.asyncio
async def test_document_request_flow(client, make_user, auth_header, db, hotel):
    """Super Admin requests → employee uploads (PENDING→UPLOADED, tagged to them) → approve."""
    from app.employees import service as emp_service

    admin = await make_user("owner2@nirai.com", Role.SUPER_ADMIN.value)
    staff = await make_user("selvi@nirai.com", Role.STAFF.value)
    emp = await emp_service.create_employee(db, hotel.id, full_name="Selvi")
    await emp_service.update_employee(db, emp, user_id=staff.id)
    ah, sh = auth_header(admin), auth_header(staff)

    req = await client.post(
        "/api/documents/requests", headers=ah,
        json={"employee_id": str(emp.id), "doc_type": "EMPLOYEE_DOC", "title": "Passport"},
    )
    assert req.status_code == 201
    rid = req.json()["id"]
    assert req.json()["status"] == "PENDING"

    mine = await client.get("/api/me/document-requests", headers=sh)
    assert any(r["id"] == rid for r in mine.json())

    up = await client.post(
        f"/api/me/document-requests/{rid}/upload", headers=sh,
        files={"file": ("passport.pdf", PDF, "application/pdf")},
    )
    assert up.status_code == 200
    assert up.json()["status"] == "UPLOADED"
    mydocs = (await client.get("/api/me/documents", headers=sh)).json()
    assert any(d["title"] == "Passport" for d in mydocs)

    ap = await client.post(f"/api/documents/requests/{rid}/approve", headers=ah)
    assert ap.status_code == 200
    assert ap.json()["status"] == "APPROVED"


@pytest.mark.asyncio
async def test_cashier_cannot_upload(client, make_user, auth_header):
    cashier = await make_user("cash@nirai.com", Role.CASHIER.value)
    resp = await client.post(
        "/api/documents",
        headers=auth_header(cashier),
        files={"file": ("x.pdf", PDF, "application/pdf")},
        data={"doc_type": "OTHER"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_documents_isolated_between_hotels(client, make_user, auth_header, db):
    from app.hotels.models import Hotel

    other = Hotel(name="Other", country="IN", base_currency="INR")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    a = await make_user("a@nirai.com", Role.SUPER_ADMIN.value)
    b = await make_user("a@other.com", Role.SUPER_ADMIN.value, hotel_id=other.id)
    await client.post("/api/documents", headers=auth_header(a),
                      files={"file": ("a.pdf", PDF, "application/pdf")}, data={"doc_type": "OTHER", "title": "Mine"})
    other_list = (await client.get("/api/documents", headers=auth_header(b))).json()
    assert other_list == []
