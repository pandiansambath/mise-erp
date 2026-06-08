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
