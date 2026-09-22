"""Handing a restaurant to somebody else, and every way that must be refused.

    "we need a super secured migraiton feature ... for migration both side
     need to accept ... if new email alreay in our datadvase then dont allow
     ... also check email is valid before migration"

The refusals ARE the feature. A transfer that works is one function call; a
transfer that cannot be tricked into moving somebody's restaurant to the
wrong person is the reason this has a state machine, a token and a table.

So most of what is below is things NOT happening.
"""
import pytest

from app.auth.models import Role, User
from app.hotels import transfer_service as svc
from app.hotels.transfer_models import HotelTransfer, TransferKind, TransferState

pytestmark = pytest.mark.asyncio


async def _owner(make_user, email="owner@nirai.com"):
    return await make_user(email, Role.SUPER_ADMIN.value)


# ── the address ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["nope", "a@b", "no spaces@x.com", "@x.com", "x@.com", ""])
async def test_a_bad_address_is_refused_before_anything_is_stored(db, hotel, make_user, bad):
    """Checked BEFORE the row exists. An unreachable address turns a transfer
    into a restaurant nobody can claim and nobody can cancel."""
    owner = await _owner(make_user)
    with pytest.raises(svc.TransferError):
        await svc.request_transfer(
            db, hotel=hotel, owner=owner, to_email=bad, kind=TransferKind.COPY.value
        )


async def test_an_address_that_already_has_an_account_is_refused(db, hotel, make_user):
    """His rule, and the database's: `users.email` is globally unique and a
    user belongs to exactly one restaurant."""
    owner = await _owner(make_user)
    await make_user("taken@nirai.com", Role.MANAGER.value)

    with pytest.raises(svc.TransferError) as err:
        await svc.request_transfer(
            db, hotel=hotel, owner=owner, to_email="taken@nirai.com",
            kind=TransferKind.COPY.value,
        )
    # The same sentence whoever asks: naming which addresses are registered
    # would make this a way to enumerate other people's customers.
    assert "already has an account" in str(err.value)


async def test_the_check_is_case_insensitive(db, hotel, make_user):
    owner = await _owner(make_user)
    await make_user("taken@nirai.com", Role.MANAGER.value)
    with pytest.raises(svc.TransferError):
        await svc.request_transfer(
            db, hotel=hotel, owner=owner, to_email="TAKEN@Nirai.com",
            kind=TransferKind.COPY.value,
        )


async def test_you_cannot_transfer_to_yourself(db, hotel, make_user):
    owner = await _owner(make_user)
    with pytest.raises(svc.TransferError):
        await svc.request_transfer(
            db, hotel=hotel, owner=owner, to_email=owner.email,
            kind=TransferKind.COPY.value,
        )


# ── who may ask ───────────────────────────────────────────────────────────

async def test_only_the_owner_can_give_the_restaurant_away(db, hotel, make_user):
    manager = await make_user("manager@nirai.com", Role.MANAGER.value)
    with pytest.raises(svc.TransferError) as err:
        await svc.request_transfer(
            db, hotel=hotel, owner=manager, to_email="new@nirai.com",
            kind=TransferKind.MOVE.value,
        )
    assert "owner" in str(err.value).lower()


async def test_only_one_transfer_can_be_open_at_a_time(db, hotel, make_user):
    """Two outstanding moves is a race with somebody's whole business as the
    stake: both accepted, and whichever executes second finds the data gone."""
    owner = await _owner(make_user)
    await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="first@nirai.com",
        kind=TransferKind.COPY.value,
    )
    with pytest.raises(svc.TransferError) as err:
        await svc.request_transfer(
            db, hotel=hotel, owner=owner, to_email="second@nirai.com",
            kind=TransferKind.COPY.value,
        )
    assert "already a transfer" in str(err.value)


async def test_a_cancelled_request_frees_the_restaurant_for_another(db, hotel, make_user):
    owner = await _owner(make_user)
    first = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="first@nirai.com",
        kind=TransferKind.COPY.value,
    )
    await svc.cancel(db, first, by=owner)
    assert first.state == TransferState.CANCELLED.value
    assert first.accept_token is None, "a cancelled link must stop working"

    second = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="second@nirai.com",
        kind=TransferKind.COPY.value,
    )
    assert second.state == TransferState.REQUESTED.value


# ── the token ─────────────────────────────────────────────────────────────

async def test_the_request_moves_nothing(db, hotel, make_user):
    """The sender's half is a request, not an action."""
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.MOVE.value,
    )
    assert row.state == TransferState.REQUESTED.value
    assert row.settled_at is None
    await db.refresh(owner)
    assert owner.is_active is True, "the sender keeps their account until it completes"


async def test_a_spent_token_cannot_be_used_twice(db, hotel, make_user):
    """A forwarded email must not be a second chance."""
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.COPY.value,
    )
    token = row.accept_token
    await svc.decline(db, row)
    assert await svc.by_token(db, token) is None


async def test_an_expired_invitation_settles_itself(db, hotel, make_user):
    """An abandoned request must stop being a standing offer to take over a
    restaurant."""
    from datetime import UTC, datetime, timedelta

    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.COPY.value,
    )
    token = row.accept_token
    row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db.flush()

    assert await svc.by_token(db, token) is None
    await db.refresh(row)
    assert row.state == TransferState.EXPIRED.value
    assert row.accept_token is None


async def test_a_nonsense_token_finds_nothing(db):
    assert await svc.by_token(db, "not-a-real-token") is None
    assert await svc.by_token(db, "") is None


# ── accepting ─────────────────────────────────────────────────────────────

async def test_a_short_password_is_refused(db, hotel, make_user):
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.COPY.value,
    )
    with pytest.raises(svc.TransferError):
        await svc.accept(db, row, password="short")


async def test_a_move_hands_over_the_same_restaurant(db, hotel, make_user):
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.MOVE.value,
    )
    row, new_owner = await svc.accept(db, row, password="BrandNewPass123")

    assert row.state == TransferState.DONE.value
    assert new_owner.email == "new@nirai.com"
    assert new_owner.hotel_id == hotel.id
    assert new_owner.role == Role.SUPER_ADMIN.value
    assert row.result_hotel_id == hotel.id, "a move produces no second restaurant"

    # The old owner is DEACTIVATED, not deleted: their id is on years of
    # audit rows, and the history is what a new owner most needs intact.
    await db.refresh(owner)
    assert owner.is_active is False
    assert (await db.get(User, owner.id)) is not None


async def test_the_new_owner_does_not_inherit_the_old_password(db, hotel, make_user):
    """The tempting implementation — rewrite the email column — carries the
    password with it, so the new owner signs in on the old owner's credential
    and neither of them knows."""
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.MOVE.value,
    )
    _row, new_owner = await svc.accept(db, row, password="BrandNewPass123")
    assert new_owner.id != owner.id
    assert new_owner.password_hash != owner.password_hash


async def test_accepting_twice_is_refused(db, hotel, make_user):
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.MOVE.value,
    )
    await svc.accept(db, row, password="BrandNewPass123")
    with pytest.raises(svc.TransferError):
        await svc.accept(db, row, password="BrandNewPass123")


async def test_a_demoted_sender_cannot_still_hand_it_over(db, hotel, make_user):
    """Re-checked at EXECUTION time, not trusted from the request. Days pass,
    and the person who asked may no longer own anything."""
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.MOVE.value,
    )
    owner.is_active = False
    await db.flush()

    with pytest.raises(svc.TransferError) as err:
        await svc.accept(db, row, password="BrandNewPass123")
    assert "no longer the owner" in str(err.value)


async def test_an_address_taken_after_the_request_is_refused_at_accept(
    db, hotel, make_user
):
    """The window between asking and accepting is days long; somebody can
    sign up with that address inside it."""
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.COPY.value,
    )
    await make_user("new@nirai.com", Role.STAFF.value)

    with pytest.raises(svc.TransferError) as err:
        await svc.accept(db, row, password="BrandNewPass123")
    assert "in the meantime" in str(err.value)


async def test_a_copy_leaves_the_original_alone(db, hotel, make_user):
    """Both restaurants exist afterwards, and the first one is untouched."""
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.COPY.value,
    )
    row, new_owner = await svc.accept(
        db, row, password="BrandNewPass123", new_name="Second Kitchen"
    )

    assert row.result_hotel_id is not None
    assert row.result_hotel_id != hotel.id
    assert new_owner.hotel_id == row.result_hotel_id

    await db.refresh(owner)
    assert owner.is_active is True, "a copy must not disturb the original owner"


async def test_a_copy_gets_its_own_handle(db, hotel, make_user):
    """`username` is unique AND it is somebody's public subdomain, so it is
    minted rather than copied."""
    from app.hotels.models import Hotel

    hotel.username = "spicegarden"
    await db.flush()
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.COPY.value,
    )
    row, _new = await svc.accept(db, row, password="BrandNewPass123")

    clone = await db.get(Hotel, row.result_hotel_id)
    assert clone.username != "spicegarden"
    assert clone.username.startswith("spicegarden-")


async def test_the_copy_keeps_the_settings_that_are_not_identity(db, hotel, make_user):
    from app.hotels.models import Hotel

    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.COPY.value,
    )
    row, _new = await svc.accept(db, row, password="BrandNewPass123")

    clone = await db.get(Hotel, row.result_hotel_id)
    assert clone.country == hotel.country
    assert clone.base_currency == hotel.base_currency


async def test_a_transfer_is_not_a_move_or_a_copy_is_refused(db, hotel, make_user):
    owner = await _owner(make_user)
    with pytest.raises(svc.TransferError):
        await svc.request_transfer(
            db, hotel=hotel, owner=owner, to_email="new@nirai.com", kind="steal"
        )


async def test_the_receiver_starts_unverified_but_not_locked_out(db, hotel, make_user):
    """Following the link proves they hold the address, which is consent to
    receive — not a confirmed subscription. They meet the same banner as
    everybody else, and they are NOT walled out."""
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.MOVE.value,
    )
    _row, new_owner = await svc.accept(db, row, password="BrandNewPass123")
    assert new_owner.email_verified is False
    assert new_owner.verify_required is False


async def test_the_history_survives_the_transfer(db, hotel, make_user):
    """The row is the answer to "what happened to my restaurant", so it stays
    readable after the fact."""
    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.MOVE.value,
    )
    rid = row.id
    await svc.accept(db, row, password="BrandNewPass123")

    kept = await db.get(HotelTransfer, rid)
    assert kept.from_email == owner.email
    assert kept.to_email == "new@nirai.com"
    assert kept.accepted_at is not None


async def test_a_copy_does_not_inherit_the_invitation_that_made_it(db, hotel, make_user):
    """CAUGHT BY THE GATE, and it was the good kind of catch.

    `hotel_transfers.requested_by` is a foreign key to `users`, and `users` is
    reachable from `hotels` — so the clone's graph walk pulled this table in
    and copied THE VERY INVITATION THAT CREATED THE COPY, accept_token and
    all. Only the unique index stopped it: the alternative was a second live
    accept link pointing at a restaurant nobody had offered.
    """
    from sqlalchemy import func, select

    owner = await _owner(make_user)
    row = await svc.request_transfer(
        db, hotel=hotel, owner=owner, to_email="new@nirai.com",
        kind=TransferKind.COPY.value,
    )
    row, _new = await svc.accept(db, row, password="BrandNewPass123")

    total = await db.scalar(select(func.count()).select_from(HotelTransfer))
    assert total == 1, "the copy must not carry a transfer record of its own"

    live_tokens = await db.scalar(
        select(func.count()).select_from(HotelTransfer)
        .where(HotelTransfer.accept_token.is_not(None))
    )
    assert live_tokens == 0, "and certainly not a live accept link"
