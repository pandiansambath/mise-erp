"""The assistant can change and remove things, and must refuse to guess.

    "give litrelly all the tools to access all the pages, do action, do edit,
     do delete, do save, do fill"

`actions.execute` only ever CREATED, so the assistant could fill a
restaurant up and never tidy it — and the failure mode of "can only add" is
a second copy of a supplier whose phone number was wrong.

THE REFUSALS ARE THE FEATURE HERE, exactly as with the transfer. Editing the
wrong supplier's price is a silent wrong answer, and silent wrong answers are
what this product cannot afford.
"""
import pytest

from app.assistant import tools
from app.auth.models import Role

pytestmark = pytest.mark.asyncio


async def _owner(make_user):
    return await make_user("owner@nirai.com", Role.SUPER_ADMIN.value)


async def _vendor(db, hotel, name):
    from app.vendors.service import create_vendor

    return await create_vendor(db, hotel.id, name=name)


async def test_it_can_change_a_detail_by_name(db, hotel, make_user):
    owner = await _owner(make_user)
    await _vendor(db, hotel, "Fresh Foods")

    out = await tools.propose_edit(
        db, owner,
        {"list": "vendors", "name": "Fresh Foods", "field": "mobile", "value": "07700900111"},
    )
    assert out.get("saved") is True
    assert "07700900111" in out["summary"]


async def test_it_refuses_to_guess_between_two_matches(db, hotel, make_user):
    """THE IMPORTANT ONE. Two suppliers whose names both contain the words he
    said is a question for him — picking the first is a wrong answer nobody
    sees until weeks later."""
    owner = await _owner(make_user)
    await _vendor(db, hotel, "Fresh Foods")
    await _vendor(db, hotel, "Fresh Foods Ltd")

    out = await tools.propose_edit(
        db, owner,
        {"list": "vendors", "name": "Fresh", "field": "mobile", "value": "07700900111"},
    )
    assert "saved" not in out
    assert "more than one" in out["error"]
    assert "Fresh Foods" in out["error"], "it must NAME them, not just refuse"


async def test_an_exact_name_wins_over_a_partial_one(db, hotel, make_user):
    """"Fresh Foods" must not be ambiguous just because "Fresh Foods Ltd"
    exists — otherwise the safer rule makes the common case impossible."""
    owner = await _owner(make_user)
    await _vendor(db, hotel, "Fresh Foods")
    await _vendor(db, hotel, "Fresh Foods Ltd")

    out = await tools.propose_edit(
        db, owner,
        {"list": "vendors", "name": "Fresh Foods", "field": "category", "value": "Produce"},
    )
    assert out.get("saved") is True


async def test_it_says_so_when_there_is_no_such_thing(db, hotel, make_user):
    owner = await _owner(make_user)
    out = await tools.propose_edit(
        db, owner,
        {"list": "vendors", "name": "Nobody", "field": "mobile", "value": "1"},
    )
    assert "can't find" in out["error"]


async def test_it_refuses_a_field_that_is_not_on_the_list(db, hotel, make_user):
    """A whitelist, not a passthrough — `setattr` on anything the model names
    is how `hotel_id` or `id` gets written."""
    owner = await _owner(make_user)
    await _vendor(db, hotel, "Fresh Foods")
    out = await tools.propose_edit(
        db, owner,
        {"list": "vendors", "name": "Fresh Foods", "field": "hotel_id", "value": "x"},
    )
    assert "saved" not in out
    assert "I can change these" in out["error"]


async def test_removing_archives_and_keeps_the_history(db, hotel, make_user):
    """A hard delete would cascade into purchase orders and payslips, or fail
    on a foreign key. `undo` already made this choice for the same models."""
    owner = await _owner(make_user)
    v = await _vendor(db, hotel, "Old Supplier")

    out = await tools.propose_remove(db, owner, {"list": "vendors", "name": "Old Supplier"})
    assert out.get("saved") is True
    assert "history kept" in out["summary"]

    await db.refresh(v)
    assert v.is_active is False
    # Still there, which is the point of archiving.
    assert await db.get(type(v), v.id) is not None


async def test_removing_something_already_gone_says_so(db, hotel, make_user):
    owner = await _owner(make_user)
    await _vendor(db, hotel, "Old Supplier")
    await tools.propose_remove(db, owner, {"list": "vendors", "name": "Old Supplier"})
    again = await tools.propose_remove(db, owner, {"list": "vendors", "name": "Old Supplier"})
    assert again.get("saved") is False
    assert "already archived" in again["summary"]


async def test_permission_is_still_the_persons(db, hotel, make_user):
    """The AI can do what its owner could do by clicking, and nothing more."""
    staff = await make_user("staff@nirai.com", Role.STAFF.value)
    await _vendor(db, hotel, "Fresh Foods")
    out = await tools.propose_remove(db, staff, {"list": "vendors", "name": "Fresh Foods"})
    assert "saved" not in out
    assert "permission" in out["error"]


async def test_an_unknown_list_is_refused_politely(db, hotel, make_user):
    owner = await _owner(make_user)
    out = await tools.propose_remove(db, owner, {"list": "payroll", "name": "x"})
    assert "I can remove" in out["error"]
