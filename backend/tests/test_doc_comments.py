"""The conversation attached to one document request.

    "here i need comment feature. superadmin and staff can comment on that doc.
     suppose anything is missing or needed he can comment and superadmin can
     read and request again nah. keep comment persistent... so that even after
     years we can find why this doc requested what issues faced."

The promise being tested is that last clause. A comment is not chat: it has to
be findable, months later, beside the thing it is about — so the tests care most
about who can reach it and that it does not move.

Written after shipping the feature, which is the wrong order. The coverage gate
passed the last deploy by 0.01 of a percentage point, and this module was a
large part of the reason.
"""
import pytest

from app.auth.models import Role

PDF = b"%PDF-1.4 fake"


async def _request(client, db, hotel, make_user, auth_header, *, staff_email="thread-staff@nirai.com"):
    """An owner, a member of staff with a login, and a request between them."""
    from app.employees import service as emp_service

    owner = await make_user("thread-owner@nirai.com", Role.SUPER_ADMIN.value)
    staff = await make_user(staff_email, Role.STAFF.value)
    emp = await emp_service.create_employee(db, hotel.id, full_name="Selvi")
    await emp_service.update_employee(db, emp, user_id=staff.id)

    made = await client.post(
        "/api/documents/requests",
        headers=auth_header(owner),
        json={"employee_id": str(emp.id), "doc_type": "EMPLOYEE_DOC", "title": "Passport"},
    )
    assert made.status_code == 201, made.text
    return owner, staff, made.json()["id"]


@pytest.mark.asyncio
async def test_both_sides_read_one_thread(client, db, hotel, make_user, auth_header):
    owner, staff, rid = await _request(client, db, hotel, make_user, auth_header)

    asked = await client.post(
        f"/api/documents/requests/{rid}/comments",
        headers=auth_header(staff),
        json={"body": "Which page do you need — the photo one?"},
    )
    assert asked.status_code == 200, asked.text
    # Recorded at WRITE time, so a later promotion cannot rewrite who was
    # speaking as what.
    assert asked.json()["from_staff"] is True
    assert asked.json()["author_name"]

    replied = await client.post(
        f"/api/documents/requests/{rid}/comments",
        headers=auth_header(owner),
        json={"body": "The photo page, and make sure the corners are in."},
    )
    assert replied.status_code == 200
    assert replied.json()["from_staff"] is False

    # One thread, read the same by both.
    for who in (owner, staff):
        seen = await client.get(
            f"/api/documents/requests/{rid}/comments", headers=auth_header(who)
        )
        assert seen.status_code == 200
        bodies = [c["body"] for c in seen.json()]
        assert bodies == [
            "Which page do you need — the photo one?",
            "The photo page, and make sure the corners are in.",
        ], "oldest first, both sides, in the order it happened"


@pytest.mark.asyncio
async def test_the_staff_member_needs_no_document_permission(
    client, db, hotel, make_user, auth_header
):
    """Being asked for your own passport does not make you an administrator.

    STAFF holds `attendance:self` and `payroll:self` and nothing else — if the
    thread required documents:read, the person the request is ABOUT could not
    answer it, which would leave the feature useful to exactly one side.
    """
    _owner, staff, rid = await _request(client, db, hotel, make_user, auth_header)

    assert (
        await client.get(f"/api/documents/requests/{rid}/comments", headers=auth_header(staff))
    ).status_code == 200
    assert (
        await client.post(
            f"/api/documents/requests/{rid}/comments",
            headers=auth_header(staff),
            json={"body": "Sent it just now."},
        )
    ).status_code == 200


@pytest.mark.asyncio
async def test_a_stranger_cannot_read_it(client, db, hotel, make_user, auth_header):
    """Another member of staff is not part of this conversation.

    404 rather than 403, for the same reason the chat rooms answer that way:
    telling somebody a thread exists but is closed to them is itself a fact
    about a colleague's paperwork.
    """
    _owner, _staff, rid = await _request(client, db, hotel, make_user, auth_header)
    nosy = await make_user("nosy@nirai.com", Role.STAFF.value)

    assert (
        await client.get(f"/api/documents/requests/{rid}/comments", headers=auth_header(nosy))
    ).status_code == 404
    assert (
        await client.post(
            f"/api/documents/requests/{rid}/comments",
            headers=auth_header(nosy),
            json={"body": "what is this"},
        )
    ).status_code == 404


@pytest.mark.asyncio
async def test_another_hotel_sees_nothing(client, db, hotel, make_user, auth_header):
    from app.hotels.models import Hotel

    _owner, _staff, rid = await _request(client, db, hotel, make_user, auth_header)

    other = Hotel(name="Next Door", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    stranger = await make_user(
        "stranger@nextdoor.com", Role.SUPER_ADMIN.value, hotel_id=other.id
    )

    assert (
        await client.get(
            f"/api/documents/requests/{rid}/comments", headers=auth_header(stranger)
        )
    ).status_code == 404


@pytest.mark.asyncio
async def test_an_empty_comment_is_not_a_comment(client, db, hotel, make_user, auth_header):
    owner, _staff, rid = await _request(client, db, hotel, make_user, auth_header)

    blank = await client.post(
        f"/api/documents/requests/{rid}/comments",
        headers=auth_header(owner),
        json={"body": "   "},
    )
    assert blank.status_code == 400

    # And the schema refuses one that is merely absent.
    assert (
        await client.post(
            f"/api/documents/requests/{rid}/comments", headers=auth_header(owner), json={}
        )
    ).status_code == 422


@pytest.mark.asyncio
async def test_a_request_that_does_not_exist(client, db, hotel, make_user, auth_header):
    import uuid

    owner, _staff, _rid = await _request(client, db, hotel, make_user, auth_header)
    ghost = uuid.uuid4()

    assert (
        await client.get(f"/api/documents/requests/{ghost}/comments", headers=auth_header(owner))
    ).status_code == 404
    assert (
        await client.post(
            f"/api/documents/requests/{ghost}/comments",
            headers=auth_header(owner),
            json={"body": "hello?"},
        )
    ).status_code == 404


@pytest.mark.asyncio
async def test_the_thread_outlives_the_upload(client, db, hotel, make_user, auth_header):
    """The point of the feature: why a document was chased is still there after
    it arrives. A thread that is cleared on upload answers nothing in a year."""
    owner, staff, rid = await _request(client, db, hotel, make_user, auth_header)

    await client.post(
        f"/api/documents/requests/{rid}/comments",
        headers=auth_header(owner),
        json={"body": "The first one was too blurred to read."},
    )
    up = await client.post(
        f"/api/me/document-requests/{rid}/upload",
        headers=auth_header(staff),
        files={"file": ("passport.pdf", PDF, "application/pdf")},
    )
    assert up.status_code == 200

    after = await client.get(
        f"/api/documents/requests/{rid}/comments", headers=auth_header(owner)
    )
    assert after.status_code == 200
    assert any("too blurred" in c["body"] for c in after.json())
