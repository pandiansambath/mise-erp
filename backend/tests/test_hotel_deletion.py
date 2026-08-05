"""Permanently deleting a restaurant.

The most destructive thing this software can do, so these tests are less about
"does it delete" than about the four things that must stand between an operator
and an accident:

  1. only a platform operator can reach it at all
  2. the handle must be typed EXACTLY
  3. nothing is deleted unless the archive succeeded first
  4. when it does run, it leaves nothing behind — a half-deleted hotel, with
     users gone but sales still referencing it, is worse than a failed delete

The archive is patched out in most of these because we are testing the refusal
logic, not S3. The one test that matters most is the one where archiving FAILS.
"""
import json
import uuid

import pytest

from app.auth.models import Role
from app.hotels.models import Hotel
from app.inventory.models import Item
from app.platform_admin import deletion


@pytest.fixture
async def victim(db) -> Hotel:
    """A restaurant with something in it, so the counts are not all zero."""
    h = Hotel(name="Doomed Diner", country="GB", base_currency="GBP", city="Leeds")
    h.username = "doomed"
    db.add(h)
    await db.commit()
    await db.refresh(h)
    db.add(Item(hotel_id=h.id, name="Tomato", unit="kg", current_stock=5))
    db.add(Item(hotel_id=h.id, name="Onion", unit="kg", current_stock=9))
    await db.commit()
    return h


@pytest.fixture
async def operator(make_user, db):
    user = await make_user("operator@dineai.cloud", Role.SUPER_ADMIN.value)
    user.is_platform_owner = True
    await db.commit()
    await db.refresh(user)
    return user


async def test_preview_counts_what_would_be_destroyed(db, victim) -> None:
    """'Delete Doomed Diner?' is a question nobody can answer well. '61 items,
    1,204 sales lines and 38 payslips?' is."""
    out = await deletion.preview(db, victim.id)

    assert out["counts"]["items"] == 2
    assert out["total_rows"] >= 2
    # counting must not have removed anything
    assert (await deletion.preview(db, victim.id))["counts"]["items"] == 2


async def test_preview_of_an_empty_hotel_is_empty_not_an_error(db, hotel) -> None:
    out = await deletion.preview(db, hotel.id)
    assert out["total_rows"] == sum(out["counts"].values())


async def test_a_hotel_owner_cannot_delete_anything(
    client, make_user, auth_header, victim, db
) -> None:
    """Not even their own restaurant. This is a platform-operator action; a
    tenant deleting itself has no undo and no support conversation first."""
    owner = await make_user("owner@test.com", Role.SUPER_ADMIN.value)
    res = await client.post(
        f"/api/platform/hotels/{victim.id}/delete",
        json={"confirm_handle": "doomed"},
        headers=auth_header(owner),
    )
    assert res.status_code in (401, 403)

    # and the restaurant is still standing
    assert (await deletion.preview(db, victim.id))["counts"]["items"] == 2


async def test_the_handle_must_match_exactly(client, operator, auth_header, victim, db) -> None:
    """A near-miss is a refusal. Anything looser and a stray paste deletes a
    business."""
    for wrong in ("", "doome", "doomed diner", "DOOMED!", "some-other-hotel"):
        res = await client.post(
            f"/api/platform/hotels/{victim.id}/delete",
            json={"confirm_handle": wrong},
            headers=auth_header(operator),
        )
        assert res.status_code == 400, wrong
        assert "exactly" in res.json()["detail"].lower()

    assert await db.get(Hotel, victim.id) is not None


async def test_case_and_padding_are_forgiven(
    client, operator, auth_header, victim, monkeypatch
) -> None:
    """Typing is the decision; shift-lock is not part of it."""
    monkeypatch.setattr(deletion, "archive", _fake_archive)
    res = await client.post(
        f"/api/platform/hotels/{victim.id}/delete",
        json={"confirm_handle": "  DOOMED  "},
        headers=auth_header(operator),
    )
    assert res.status_code == 200


async def test_nothing_is_deleted_when_the_archive_fails(
    client, operator, auth_header, victim, db, monkeypatch
) -> None:
    """THE test. An irreversible action must not proceed on a best-effort
    backup — if the copy did not happen, the delete does not happen."""

    async def _no_archive(*_a, **_kw):
        return None

    monkeypatch.setattr(deletion, "archive", _no_archive)

    res = await client.post(
        f"/api/platform/hotels/{victim.id}/delete",
        json={"confirm_handle": "doomed"},
        headers=auth_header(operator),
    )
    assert res.status_code == 503
    assert "nothing was deleted" in res.json()["detail"].lower()

    # the hotel AND its rows are untouched
    assert await db.get(Hotel, victim.id) is not None
    assert (await deletion.preview(db, victim.id))["counts"]["items"] == 2


async def test_a_successful_delete_leaves_nothing_behind(
    client, operator, auth_header, victim, db, monkeypatch
) -> None:
    """Children first, then the hotel, in one transaction. Orphaned rows
    pointing at a hotel that no longer exists are the failure mode this is
    ordered to prevent."""
    monkeypatch.setattr(deletion, "archive", _fake_archive)
    victim_id = victim.id

    res = await client.post(
        f"/api/platform/hotels/{victim.id}/delete",
        json={"confirm_handle": "doomed", "reason": "test tenant, agreed with the owner"},
        headers=auth_header(operator),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["removed"]["items"] == 2
    assert body["archive_key"]

    # Hold the id BEFORE expiring: reading an attribute off an expired instance
    # triggers a synchronous refresh, which an async session cannot do.
    db.expire_all()
    assert await db.get(Hotel, victim_id) is None
    assert (await deletion.preview(db, victim_id))["total_rows"] == 0


async def test_deleting_one_hotel_does_not_touch_another(
    client, operator, auth_header, victim, hotel, db, monkeypatch
) -> None:
    """Every delete is filtered by hotel_id. The whole tenancy model rests on
    that being true here, of all places."""
    monkeypatch.setattr(deletion, "archive", _fake_archive)
    victim_id, survivor_id = victim.id, hotel.id
    db.add(Item(hotel_id=survivor_id, name="Survivor", unit="kg", current_stock=1))
    await db.commit()

    res = await client.post(
        f"/api/platform/hotels/{victim_id}/delete",
        json={"confirm_handle": "doomed"},
        headers=auth_header(operator),
    )
    assert res.status_code == 200

    db.expire_all()
    assert await db.get(Hotel, survivor_id) is not None
    assert (await deletion.preview(db, survivor_id))["counts"]["items"] == 1


async def test_deleting_a_hotel_that_does_not_exist_is_a_404(
    client, operator, auth_header
) -> None:
    res = await client.post(
        f"/api/platform/hotels/{uuid.uuid4()}/delete",
        json={"confirm_handle": "anything"},
        headers=auth_header(operator),
    )
    assert res.status_code == 404


async def test_the_table_order_puts_children_before_parents(db) -> None:
    """Nothing cascades, on purpose: a careless DELETE FROM hotels fails rather
    than silently emptying the database. That only holds if this list is in
    dependency order."""
    order = deletion.ORDERED_TABLES
    pairs = [
        ("po_items", "purchase_orders"),
        ("indent_items", "indents"),
        ("recipe_ingredients", "recipes"),
        ("vendor_items", "vendors"),
        ("order_items", "orders"),
        ("sales_lines", "sales_channels"),
        ("job_applications", "job_postings"),
        ("chat_messages", "chats"),
        ("assistant_messages", "assistant_threads"),
        ("party_quote_lines", "party_quotes"),
        ("attendance", "employees"),
        ("payroll", "employees"),
    ]
    for child, parent in pairs:
        assert order.index(child) < order.index(parent), f"{child} must be emptied before {parent}"

    # and the hotel row itself is never in the child list — purge() removes it
    # last, explicitly
    assert "hotels" not in order


async def _fake_archive(*_a, **_kw) -> str:
    """S3 is not what these tests are about; refusing without one is."""
    return "deleted-hotels/test-archive.json"


# ── the archive itself ────────────────────────────────────────────────────
# Patched out above, because those tests are about the refusals. But the
# archive is what decides whether an irreversible action may run at all, so it
# needs its own.


async def test_no_bucket_configured_means_no_archive_and_so_no_delete(
    db, victim, monkeypatch
) -> None:
    """A stack with nowhere to put the copy must not delete. This is the
    likeliest real-world version of the failure: a fresh environment where the
    bucket was never set."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "s3_bucket", "", raising=False)
    assert await deletion.archive(db, victim.id, "doomed") is None


async def test_the_archive_contains_every_row_and_the_hotel_itself(
    db, victim, monkeypatch
) -> None:
    """What gets written IS the way back, so it has to be everything — the
    child rows AND the hotel record, or the restaurant cannot be reconstructed
    from it."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "s3_bucket", "test-bucket", raising=False)
    written: dict = {}

    class _FakeS3:
        def put_object(self, **kw):
            written.update(kw)

    monkeypatch.setattr(
        "boto3.client", lambda *_a, **_kw: _FakeS3()
    )

    key = await deletion.archive(db, victim.id, "doomed")
    assert key is not None
    assert key.startswith("deleted-hotels/doomed-")
    assert written["Bucket"] == "test-bucket"

    dump = json.loads(written["Body"].decode())
    assert len(dump["items"]) == 2
    assert len(dump["hotels"]) == 1
    assert dump["hotels"][0]["name"] == "Doomed Diner"


async def test_a_broken_s3_reports_failure_rather_than_pretending(
    db, victim, monkeypatch
) -> None:
    """It must return None — the caller reads that as "refuse". Swallowing the
    error and returning a key would let a delete proceed with no copy."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "s3_bucket", "test-bucket", raising=False)

    def _explode(*_a, **_kw):
        raise RuntimeError("S3 is down")

    monkeypatch.setattr("boto3.client", _explode)
    assert await deletion.archive(db, victim.id, "doomed") is None
