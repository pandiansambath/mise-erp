"""Emptying a restaurant, and putting it back.

    "i need delete all datas feature...like it wont delete the owner login
     alone...other thatn this..it will delete litrelly all the datas...makr it
     like dangerous.... (but even if they accidnlty deleted by clickng if they
     need there datas back we need a feature in control center to revert back
     they datas to old"

THE RESTORE IS THE FEATURE. The delete is four lines; being able to undo it is
what makes it something anybody can be allowed to press. So the test that
matters is the ROUND TRIP against a real database — not that the wipe removes
rows, but that what it saved can go back in.

⚠️ THE FAKE STORE STRINGIFIES EXACTLY AS S3 DOES. `archive` writes with
`json.dumps(..., default=str)`, which turns every timestamp, date, Decimal and
UUID into a string. asyncpg refuses a `str` where the prepared statement says
`timestamptz` or `numeric`, so a restore that skipped that step would fail on
the first table with a `created_at` — which is nearly all of them. A fake store
that handed the original Python objects back would pass while production
failed, which is the only outcome worse than no test at all.
"""
import json
import uuid

import pytest

from app.auth.models import Role
from app.platform_admin import deletion
from app.vendors.models import Vendor


@pytest.fixture
def snapshot_store(monkeypatch):
    """An in-memory stand-in for S3, faithful about what JSON does to types."""
    store: dict[str, dict] = {}

    monkeypatch.setattr(deletion.settings, "s3_bucket", "test-bucket", raising=False)

    def put(key: str, payload: dict) -> bool:
        # Through JSON and back, exactly as a real upload and download would.
        store[key] = json.loads(json.dumps(payload, default=str))
        return True

    monkeypatch.setattr(deletion, "_put_snapshot", put)
    monkeypatch.setattr(deletion, "_get_snapshot", lambda key: store.get(key))
    return store


@pytest.fixture
async def owner(make_user):
    return await make_user("owner@wipe.test", Role.SUPER_ADMIN.value)


@pytest.fixture
async def operator(make_user, db):
    op = await make_user("op@wipe.test", Role.SUPER_ADMIN.value)
    op.is_platform_owner = True
    await db.commit()
    return op


async def _some_data(db, hotel) -> uuid.UUID:
    """A row with a timestamp and a UUID in it — the types that break a restore."""
    v = Vendor(hotel_id=hotel.id, name="Fresh Foods", category="FOOD", mobile="07700900111")
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return v.id


async def _count_vendors(db, hotel) -> int:
    from sqlalchemy import func, select

    return (
        await db.execute(select(func.count()).select_from(Vendor).where(Vendor.hotel_id == hotel.id))
    ).scalar_one()


# ── emptying it ───────────────────────────────────────────────────────────


async def test_the_owner_can_empty_the_restaurant(
    client, auth_header, owner, db, hotel, snapshot_store
) -> None:
    hotel.name = "Nirai"
    await db.commit()
    await _some_data(db, hotel)
    assert await _count_vendors(db, hotel) == 1

    res = await client.post(
        "/api/hotels/wipe",
        json={"password": "password123", "confirm_name": "Nirai"},
        headers=auth_header(owner),
    )
    assert res.status_code == 200, res.text
    assert await _count_vendors(db, hotel) == 0


async def test_the_owner_login_survives(
    client, auth_header, owner, db, hotel, snapshot_store
) -> None:
    """His one condition: "it wont delete the owner login alone"."""
    hotel.name = "Nirai"
    await db.commit()
    await client.post(
        "/api/hotels/wipe",
        json={"password": "password123", "confirm_name": "Nirai"},
        headers=auth_header(owner),
    )
    # Still signed in, still has a restaurant — just an empty one.
    me = await client.get("/api/auth/me", headers=auth_header(owner))
    assert me.status_code == 200


async def test_the_wrong_name_empties_nothing(
    client, auth_header, owner, db, hotel, snapshot_store
) -> None:
    """A checkbox is muscle memory. A name you have to read and type is a
    decision."""
    hotel.name = "Nirai"
    await db.commit()
    await _some_data(db, hotel)

    res = await client.post(
        "/api/hotels/wipe",
        json={"password": "password123", "confirm_name": "nira"},
        headers=auth_header(owner),
    )
    assert res.status_code == 400
    assert await _count_vendors(db, hotel) == 1


async def test_the_wrong_password_empties_nothing(
    client, auth_header, owner, db, hotel, snapshot_store
) -> None:
    hotel.name = "Nirai"
    await db.commit()
    await _some_data(db, hotel)

    res = await client.post(
        "/api/hotels/wipe",
        json={"password": "not-my-password", "confirm_name": "Nirai"},
        headers=auth_header(owner),
    )
    assert res.status_code == 403
    assert await _count_vendors(db, hotel) == 1


async def test_a_manager_cannot_empty_the_restaurant(
    client, auth_header, make_user, db, hotel, snapshot_store
) -> None:
    manager = await make_user("mgr@wipe.test", Role.MANAGER.value)
    hotel.name = "Nirai"
    await db.commit()
    await _some_data(db, hotel)

    res = await client.post(
        "/api/hotels/wipe",
        json={"password": "password123", "confirm_name": "Nirai"},
        headers=auth_header(manager),
    )
    assert res.status_code == 403
    assert await _count_vendors(db, hotel) == 1


async def test_no_snapshot_means_no_delete(client, auth_header, owner, db, hotel, monkeypatch) -> None:
    """⭐ THE ONE THAT MATTERS MOST.

    An irreversible action does not proceed on a best-effort backup. If the
    snapshot cannot be taken, NOTHING is deleted — otherwise this feature is a
    trap with a confirmation dialog in front of it.
    """
    hotel.name = "Nirai"
    await db.commit()
    await _some_data(db, hotel)
    monkeypatch.setattr(deletion, "_put_snapshot", lambda key, payload: False)
    monkeypatch.setattr(deletion.settings, "s3_bucket", "test-bucket", raising=False)

    res = await client.post(
        "/api/hotels/wipe",
        json={"password": "password123", "confirm_name": "Nirai"},
        headers=auth_header(owner),
    )
    assert res.status_code == 503
    assert await _count_vendors(db, hotel) == 1, "a failed backup must delete nothing"


# ── putting it back ───────────────────────────────────────────────────────


async def test_the_control_room_can_put_it_back(
    client, auth_header, owner, operator, db, hotel, snapshot_store
) -> None:
    """⭐ THE ROUND TRIP. Wipe, then restore, and the data is there again."""
    hotel.name = "Nirai"
    hotel.username = "nirai1"
    await db.commit()
    vendor_id = await _some_data(db, hotel)

    wiped = await client.post(
        "/api/hotels/wipe",
        json={"password": "password123", "confirm_name": "Nirai"},
        headers=auth_header(owner),
    )
    assert wiped.status_code == 200, wiped.text
    assert await _count_vendors(db, hotel) == 0

    key = next(iter(snapshot_store))
    back = await client.post(
        f"/api/platform/hotels/{hotel.id}/restore",
        json={"key": key, "confirm_handle": "nirai1"},
        headers=auth_header(operator),
    )
    assert back.status_code == 200, back.text

    restored = await db.get(Vendor, vendor_id)
    assert restored is not None, "the vendor must come back, with its own id"
    assert restored.name == "Fresh Foods"


async def test_it_refuses_a_snapshot_from_another_restaurant(
    client, auth_header, operator, db, hotel, snapshot_store
) -> None:
    """The single worst thing this endpoint could do."""
    hotel.username = "nirai1"
    await db.commit()
    snapshot_store["someone-elses.json"] = {
        "version": 2,
        "hotel_id": str(uuid.uuid4()),
        "order": [],
        "tables": {},
    }
    res = await client.post(
        f"/api/platform/hotels/{hotel.id}/restore",
        json={"key": "someone-elses.json", "confirm_handle": "nirai1"},
        headers=auth_header(operator),
    )
    assert res.status_code == 400
    assert "different restaurant" in res.json()["detail"]


async def test_it_refuses_to_restore_over_live_data(
    client, auth_header, operator, db, hotel, snapshot_store
) -> None:
    """Two of everything, with no way to tell them apart, is worse than
    nothing coming back."""
    hotel.username = "nirai1"
    await db.commit()
    await _some_data(db, hotel)

    key = await deletion.archive(db, hotel.id, "nirai1")
    assert key, "the fake store should have accepted it"

    # The data is still there — nothing was wiped.
    res = await client.post(
        f"/api/platform/hotels/{hotel.id}/restore",
        json={"key": key, "confirm_handle": "nirai1"},
        headers=auth_header(operator),
    )
    assert res.status_code == 400
    assert "already data here" in res.json()["detail"]


async def test_a_normal_owner_cannot_restore(
    client, auth_header, owner, db, hotel, snapshot_store
) -> None:
    """The owner can empty their own restaurant. Only we can fill it again."""
    res = await client.post(
        f"/api/platform/hotels/{hotel.id}/restore",
        json={"key": "anything.json", "confirm_handle": "nirai1"},
        headers=auth_header(owner),
    )
    assert res.status_code == 403
