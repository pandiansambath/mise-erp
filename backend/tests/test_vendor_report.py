"""One supplier, consolidated.

    "in vendor page for each vednor i need confolsitead report of what we
     purcahsed from that vedor ..total value till this date to this date or..
     last month last 2month tecet...i need a export featrue we can eport as
     excel , csv pdf tooo"

The two things worth holding: a DRAFT order is not money committed, and one
restaurant must never be able to read another's suppliers.
"""
import uuid
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.purchasing.models import POStatus, PurchaseOrder
from app.vendors import report as vendor_report
from app.vendors.models import Vendor

RANGE = "date_from=2000-01-01&date_to=2099-01-01"


@pytest.fixture
async def owner(make_user):
    return await make_user("owner@vrep.test", Role.SUPER_ADMIN.value)


@pytest.fixture
async def vendor(db, hotel):
    v = Vendor(hotel_id=hotel.id, name="Meat Wala", category="FOOD")
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return v


async def _order(db, hotel, vendor, amount: str, status: str, number: str):
    po = PurchaseOrder(
        hotel_id=hotel.id,
        vendor_id=vendor.id,
        po_number=number,
        status=status,
        total_amount=Decimal(amount),
    )
    db.add(po)
    await db.commit()
    return po


# ── the picker ────────────────────────────────────────────────────────────


async def test_the_catalogue_is_offered(client, auth_header, owner) -> None:
    res = await client.get("/api/vendors/report/sections", headers=auth_header(owner))
    assert res.status_code == 200, res.text
    assert [s["key"] for s in res.json()["sections"]] == vendor_report.ALL_KEYS


async def test_the_literal_route_is_not_eaten_by_the_id_route(client, auth_header, owner) -> None:
    """⚠️ Starlette matches in DECLARATION ORDER.

    `/vendors/report/sections` sits in a file that also has
    `/vendors/{vendor_id}`, and this project has already been bitten by that
    once — a literal path behind a parameterised one is a 422 nobody can
    explain from the browser.
    """
    res = await client.get("/api/vendors/report/sections", headers=auth_header(owner))
    assert res.status_code != 422, "the id route swallowed the literal one"


async def test_asking_for_nothing_gives_everything(client, auth_header, owner, vendor) -> None:
    res = await client.get(
        f"/api/vendors/{vendor.id}/report?{RANGE}", headers=auth_header(owner)
    )
    assert res.status_code == 200, res.text
    assert [s["key"] for s in res.json()["sections"]] == vendor_report.ALL_KEYS
    assert res.json()["vendor_name"] == "Meat Wala"


async def test_asking_for_one_gives_one(client, auth_header, owner, vendor) -> None:
    res = await client.get(
        f"/api/vendors/{vendor.id}/report?{RANGE}&sections=items", headers=auth_header(owner)
    )
    assert res.status_code == 200
    assert [s["key"] for s in res.json()["sections"]] == ["items"]


# ── what counts as a purchase ─────────────────────────────────────────────


async def test_a_draft_order_is_not_money_committed(
    client, auth_header, owner, db, hotel, vendor
) -> None:
    """⭐ A DRAFT IS A SHOPPING LIST NOBODY HAS SENT.

    Counting it would tell a restaurant it owed money it has not committed,
    which is the wrong direction for a number about a supplier.
    """
    await _order(db, hotel, vendor, "100.00", POStatus.SENT.value, "PO-1")
    await _order(db, hotel, vendor, "999.00", POStatus.DRAFT.value, "PO-2")

    res = await client.get(
        f"/api/vendors/{vendor.id}/report?{RANGE}&sections=orders", headers=auth_header(owner)
    )
    body = res.json()["sections"][0]
    numbers = [r[0] for r in body["rows"]]
    assert "PO-1" in numbers
    assert "PO-2" not in numbers, "a draft was counted as a purchase"
    assert "999" not in (body["total"] or [""])[3]


async def test_ordered_and_paid_are_separate_answers(
    client, auth_header, owner, db, hotel, vendor
) -> None:
    """Showing one total that quietly means one of them is how a supplier page
    starts misleading people."""
    await _order(db, hotel, vendor, "400.00", POStatus.SENT.value, "PO-9")
    res = await client.get(
        f"/api/vendors/{vendor.id}/report?{RANGE}&sections=summary", headers=auth_header(owner)
    )
    labels = [r[0] for r in res.json()["sections"][0]["rows"]]
    assert "Ordered" in labels and "Paid" in labels and "Difference" in labels


# ── the downloads ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("fmt", "magic"),
    [("csv", b"\xef\xbb\xbf"), ("xlsx", b"PK"), ("pdf", b"%PDF"), ("docx", b"PK")],
)
async def test_every_format_downloads(client, auth_header, owner, vendor, fmt, magic) -> None:
    res = await client.get(
        f"/api/vendors/{vendor.id}/report.{fmt}?{RANGE}", headers=auth_header(owner)
    )
    assert res.status_code == 200, res.text
    assert res.content[: len(magic)] == magic, f"{fmt} is not really a {fmt}"


async def test_an_unknown_format_is_refused(client, auth_header, owner, vendor) -> None:
    res = await client.get(
        f"/api/vendors/{vendor.id}/report.rtf?{RANGE}", headers=auth_header(owner)
    )
    assert res.status_code == 404


# ── the isolation that matters most ───────────────────────────────────────


async def test_a_supplier_that_is_not_yours_is_not_found(client, auth_header, owner) -> None:
    """Same answer for "not yours" and "does not exist" — anything else turns
    this endpoint into a way to count another restaurant's suppliers."""
    res = await client.get(
        f"/api/vendors/{uuid.uuid4()}/report?{RANGE}", headers=auth_header(owner)
    )
    assert res.status_code == 404


async def test_it_needs_permission(client, auth_header, make_user, vendor) -> None:
    cashier = await make_user("cash@vrep.test", Role.CASHIER.value)
    res = await client.get(
        f"/api/vendors/{vendor.id}/report.pdf?{RANGE}", headers=auth_header(cashier)
    )
    assert res.status_code == 403
