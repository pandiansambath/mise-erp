"""Expense tests."""
from datetime import date
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.expenses import service

D1, D2 = "2026-06-01", "2026-06-30"


@pytest.mark.asyncio
async def test_default_categories_seeded(db, hotel):
    await service.ensure_default_categories(db, hotel.id)
    cats = await service.list_categories(db, hotel.id)
    by_kind = {c.kind for c in cats}
    assert by_kind == {"FIXED", "VARIABLE"}
    names = {c.name for c in cats}
    assert "Rent" in names and "Vegetables" in names
    # idempotent
    await service.ensure_default_categories(db, hotel.id)
    assert len(await service.list_categories(db, hotel.id)) == len(cats)


@pytest.mark.asyncio
async def test_summary_splits_fixed_and_variable(db, hotel):
    await service.ensure_default_categories(db, hotel.id)
    cats = {c.name: c for c in await service.list_categories(db, hotel.id)}
    d = date(2026, 6, 10)
    await service.create_expense(
        db, hotel.id, category_id=cats["Rent"].id, date=d, amount=Decimal("1000")
    )
    await service.create_expense(
        db, hotel.id, category_id=cats["Vegetables"].id, date=d, amount=Decimal("200"),
        vat_amount=Decimal("0"),
    )
    await service.create_expense(
        db, hotel.id, category_id=cats["Packaging"].id, date=d, amount=Decimal("60"),
        vat_amount=Decimal("10"),
    )
    s = await service.summary(db, hotel.id, date(2026, 6, 1), date(2026, 6, 30))
    assert s["fixed_total"] == Decimal("1000")
    assert s["variable_total"] == Decimal("260")  # 200 + 60
    assert s["vat_total"] == Decimal("10")
    assert s["grand_total"] == Decimal("1260")


# ── API + RBAC ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_accountant_can_record_expense(client, make_user, auth_header):
    acct = await make_user("acct@nirai.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    cats = (await client.get("/api/expenses/categories", headers=h)).json()
    rent = next(c for c in cats if c["name"] == "Rent")
    resp = await client.post(
        "/api/expenses",
        headers=h,
        json={"category_id": rent["id"], "date": "2026-06-05", "amount": "1200"},
    )
    assert resp.status_code == 201
    assert resp.json()["category_name"] == "Rent"
    assert resp.json()["kind"] == "FIXED"


@pytest.mark.asyncio
async def test_cashier_cannot_record_expense(client, make_user, auth_header):
    cashier = await make_user("cashier@nirai.com", Role.CASHIER.value)
    resp = await client.get("/api/expenses/categories", headers=auth_header(cashier))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_expense_summary_via_api(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    cats = (await client.get("/api/expenses/categories", headers=h)).json()
    veg = next(c for c in cats if c["name"] == "Vegetables")
    await client.post(
        "/api/expenses", headers=h, json={"category_id": veg["id"], "date": "2026-06-07", "amount": "300"}
    )
    s = (await client.get(f"/api/expenses/summary?date_from={D1}&date_to={D2}", headers=h)).json()
    assert float(s["variable_total"]) == 300.0
    assert float(s["grand_total"]) == 300.0


@pytest.mark.asyncio
async def test_expenses_isolated_between_hotels(client, make_user, auth_header, db):
    from app.hotels.models import Hotel

    other = Hotel(name="Other", country="IN", base_currency="INR")
    db.add(other)
    await db.commit()
    await db.refresh(other)

    a = await make_user("a@nirai.com", Role.SUPER_ADMIN.value)
    b = await make_user("a@other.com", Role.SUPER_ADMIN.value, hotel_id=other.id)
    cats = (await client.get("/api/expenses/categories", headers=auth_header(a))).json()
    rent = next(c for c in cats if c["name"] == "Rent")
    await client.post(
        "/api/expenses", headers=auth_header(a), json={"category_id": rent["id"], "date": "2026-06-05", "amount": "999"}
    )
    other_list = (await client.get("/api/expenses", headers=auth_header(b))).json()
    assert other_list == []  # other hotel sees nothing
    # other hotel cannot use A's category
    cross = await client.post(
        "/api/expenses",
        headers=auth_header(b),
        json={"category_id": rent["id"], "date": "2026-06-05", "amount": "1"},
    )
    assert cross.status_code == 404
