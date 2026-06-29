"""Strict import templates — generation + exact-error validation (pure + endpoint)."""
import io

import pytest
from openpyxl import Workbook

from app.auth.models import Role
from app.core import template_io
from app.core.template_io import XLSX_MIME, Column, TemplateSpec

SPEC = TemplateSpec(
    name="Test items",
    columns=[
        Column("name", "Name", required=True, aliases=("item",)),
        Column("unit", "Unit", required=True),
        Column("cost_price", "Cost price", kind="number", aliases=("price",)),
    ],
    sample_rows=[["Rice", "kg", 1.2]],
)


def _xlsx(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def test_generated_xlsx_template_roundtrips():
    tpl = template_io.template_xlsx(SPEC)  # styled: header on row 3, sample on row 4
    rows, errors = template_io.parse_upload(tpl, "t.xlsx", XLSX_MIME, SPEC)
    assert errors == []
    assert rows[0]["name"] == "Rice" and rows[0]["unit"] == "kg"
    assert rows[0]["cost_price"] == 1.2


def test_missing_required_column_is_reported():
    data = _xlsx([["Name", "Cost price"], ["Rice", 1.2]])  # no Unit
    rows, errors = template_io.parse_upload(data, "t.xlsx", XLSX_MIME, SPEC)
    assert rows == [] and any("Unit" in e for e in errors)


def test_bad_number_gives_row_error():
    data = _xlsx([["Name", "Unit", "Cost price"], ["Rice", "kg", "abc"]])
    rows, errors = template_io.parse_upload(data, "t.xlsx", XLSX_MIME, SPEC)
    assert rows == [] and any("number" in e.lower() for e in errors)


def test_missing_required_value_gives_row_error():
    data = _xlsx([["Name", "Unit"], ["", "kg"]])
    rows, errors = template_io.parse_upload(data, "t.xlsx", XLSX_MIME, SPEC)
    assert rows == [] and any("required" in e.lower() for e in errors)


def test_csv_with_aliased_headers_parses():
    csv = b"Item,Unit,Price\nRice,kg,2\n"  # aliases: Item->name, Price->cost_price
    rows, errors = template_io.parse_upload(csv, "t.csv", "text/csv", SPEC)
    assert errors == []
    assert rows[0]["name"] == "Rice" and rows[0]["cost_price"] == 2.0


def test_unreadable_file_is_rejected():
    rows, errors = template_io.parse_upload(b"%PDF-1.4 not a sheet", "x.pdf", "application/pdf", SPEC)
    assert rows == [] and errors


# ── Endpoint wiring (inventory) ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_inventory_template_download(client, make_user, auth_header):
    user = await make_user("tpl@x.com", Role.SUPER_ADMIN.value)
    r = await client.get("/api/inventory/template.xlsx", headers=auth_header(user))
    assert r.status_code == 200 and "spreadsheet" in r.headers["content-type"]


@pytest.mark.asyncio
async def test_inventory_import_template_valid_and_invalid(client, make_user, auth_header):
    h = auth_header(await make_user("tpl2@x.com", Role.SUPER_ADMIN.value))
    good = b"Name,Unit,Category,Opening stock\nRice,kg,Dry Goods,25\n"
    ok = await client.post(
        "/api/inventory/import-template", headers=h,
        files={"file": ("items.csv", good, "text/csv")},
    )
    assert ok.status_code == 200
    assert ok.json()["rows"][0]["name"] == "Rice"

    bad = b"Category\nDry Goods\n"  # no Name/Unit columns
    res = await client.post(
        "/api/inventory/import-template", headers=h,
        files={"file": ("items.csv", bad, "text/csv")},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["errors"]  # exact problems returned


@pytest.mark.asyncio
async def test_inventory_import_template_commit_creates_items(client, make_user, auth_header):
    h = auth_header(await make_user("tpl3@x.com", Role.SUPER_ADMIN.value))
    good = b"Name,Unit,Category,Opening stock\nBasmati Rice,kg,Dry Goods,25\n"
    prev = await client.post(
        "/api/inventory/import-template", headers=h,
        files={"file": ("i.csv", good, "text/csv")},
    )
    rows = prev.json()["rows"]
    res = await client.post("/api/inventory/import-template/commit", headers=h, json={"rows": rows})
    assert res.status_code == 200 and "Basmati Rice" in res.json()["created"]
    items = (await client.get("/api/inventory/items", headers=h)).json()
    assert any("basmati" in i["name"].lower() for i in items)


@pytest.mark.asyncio
async def test_inventory_template_pdf(client, make_user, auth_header):
    h = auth_header(await make_user("tpl4@x.com", Role.SUPER_ADMIN.value))
    r = await client.get("/api/inventory/template.pdf", headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content[:4] == b"%PDF"
