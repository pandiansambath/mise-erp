"""Hotel (tenant) settings — Super Admin configures the break policy + brand logo."""
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit_service
from app.auth.deps import get_current_user, require
from app.auth.models import Role, User
from app.auth.schemas import HotelOut, HotelUpdate
from app.core import timezones
from app.core.database import get_db
from app.core.security import verify_password
from app.core.storage import get_storage
from app.hotels import onboarding
from app.hotels import prefs as prefs_mod
from app.hotels.models import Hotel
from app.platform_admin import deletion

router = APIRouter(prefix="/hotels", tags=["hotels"])

_LOGO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg"}


@router.get("/timezones")
async def list_timezones(user: User = Depends(get_current_user)) -> dict:
    """The zones Settings may offer. Served from the same list the server
    validates against, so the dropdown can never show an unaccepted option."""
    return {"timezones": timezones.CHOICES, "default": timezones.DEFAULT}


@router.get("/onboarding")
async def onboarding_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """What a new restaurant still has to set up, and what to do next.

    Read-only and counted from real rows, so it cannot disagree with the app.
    Everyone can see it — a manager filling in stock is exactly who this is
    for, not only the owner.
    """
    return await onboarding.status(db, user.hotel_id)


@router.get("/me", response_model=HotelOut)
async def my_hotel(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> HotelOut:
    hotel = await db.get(Hotel, user.hotel_id)
    return HotelOut.model_validate(hotel)


@router.patch("/me", response_model=HotelOut)
async def update_my_hotel(
    payload: HotelUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> HotelOut:
    hotel = await db.get(Hotel, user.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    data = payload.model_dump(exclude_unset=True)

    # A bad zone would not error — it would quietly move every business day.
    # Reject it here rather than fall back at read time and leave the setting
    # showing something the app is not actually using.
    tz = data.get("timezone")
    if tz is not None and not timezones.is_valid(tz):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{tz!r} is not a timezone we support.",
        )

    # Preferences merge. setattr would replace the whole bag, so a request that
    # only changes how PDFs group would wipe the decimal settings with it.
    incoming = data.pop("prefs", None)
    if incoming is not None:
        merged = dict(hotel.prefs or {})
        merged.update(incoming)
        # VALIDATE WHAT THEY ARE CHANGING, not what is already stored.
        #
        # This checked the MERGED bag, so a key written by some other part of
        # the app — ordering stores `kds_code` the first time the kitchen screen
        # is opened — made every later preference save fail with 422, whatever
        # it was trying to change. One undeclared key silently froze every
        # setting in the product, and the failure surfaced as "the button does
        # nothing".
        #
        # A request can only be wrong about what it sends.
        unknown = set(incoming) - set(prefs_mod.DEFAULTS)
        if unknown:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Unknown preference(s): {', '.join(sorted(unknown))}",
            )
        hotel.prefs = merged

    for key, value in data.items():
        setattr(hotel, key, value)
    await db.commit()
    await db.refresh(hotel)
    return HotelOut.model_validate(hotel)


@router.post("/logo", response_model=HotelOut)
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> HotelOut:
    """Upload the hotel's brand logo (PNG/JPG). Replaces the default DineAI mark in the
    app UI and on PDFs. Stored in S3/local; served publicly from /hotels/{id}/logo."""
    ext = _LOGO_TYPES.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be a PNG or JPG image")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Logo too large (max 2 MB)")
    hotel = await db.get(Hotel, user.hotel_id)
    storage = get_storage()
    if hotel.logo_key:
        try:
            storage.delete(hotel.logo_key)
        except Exception:  # noqa: BLE001 — best-effort cleanup of the old file
            pass
    hotel.logo_key = storage.save(user.hotel_id, uuid.uuid4(), f"logo{ext}", data)
    await db.commit()
    await db.refresh(hotel)
    return HotelOut.model_validate(hotel)


@router.delete("/logo", response_model=HotelOut)
async def delete_logo(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> HotelOut:
    """Remove the hotel logo — reverts to the default DineAI mark everywhere."""
    hotel = await db.get(Hotel, user.hotel_id)
    if hotel.logo_key:
        try:
            get_storage().delete(hotel.logo_key)
        except Exception:  # noqa: BLE001
            pass
        hotel.logo_key = None
        await db.commit()
        await db.refresh(hotel)
    return HotelOut.model_validate(hotel)


@router.get("/{hotel_id}/logo")
async def get_logo(hotel_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Serve a hotel's logo image. PUBLIC (no auth) so <img> tags + PDFs can load it —
    logos aren't sensitive. 404 when the hotel has no logo."""
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None or not hotel.logo_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No logo")
    try:
        data = get_storage().read(hotel.logo_key)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No logo") from exc
    media = "image/png" if hotel.logo_key.endswith(".png") else "image/jpeg"
    return Response(
        content=data, media_type=media, headers={"Cache-Control": "public, max-age=300"}
    )


class _OnboardingChoice(BaseModel):
    """One decision about the onboarding, from the person doing it."""

    #: For skip/unskip. Which step.
    step: str | None = Field(default=None, max_length=40)
    #: For the dashboard card: how many days to stay quiet.
    days: int = Field(default=7, ge=1, le=90)



# ── emptying the restaurant ────────────────────────────────────────────────
#
#     "i need delete all datas feature...like it wont delete the owner login
#      alone...other thatn this..it will delete litrelly all the datas...makr
#      it like dangerous.... (but even if they accidnlty deleted by clickng if
#      they need there datas back we need a feature in control center to revert
#      back they datas to old"
#
# THE RESTORE IS THE FEATURE. The delete is four lines; being able to undo it
# is what makes it something anybody can be allowed to press. A wipe with no
# way back is not a feature, it is a trap with a confirmation dialog in front
# of it — so this refuses outright if the snapshot cannot be taken.


class WipeRequest(BaseModel):
    """Two independent proofs, because this cannot be taken back by the person
    doing it — only by us, from the Control Room."""

    password: str
    #: The restaurant's own name, typed out. A checkbox is muscle memory; a
    #: name you have to read off the screen and type is a decision.
    confirm_name: str


@router.post("/wipe")
async def wipe_my_hotel(
    payload: WipeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """Delete every record in this restaurant, keeping the logins.

    DIFFERENT FROM THE OPERATOR'S DELETE, which removes the restaurant itself.
    This keeps the hotel row and its users — he was explicit that the owner
    login survives — so they are still signed in afterwards, looking at an
    empty product. That is also the only version that is recoverable, because
    there is still an account to restore INTO.
    """
    if user.role != Role.SUPER_ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the owner can empty this restaurant."
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That password is not right.")

    hotel = await db.get(Hotel, user.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")

    expected = (hotel.name or "").strip().lower()
    if payload.confirm_name.strip().lower() != expected:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That does not match. Type “{hotel.name}” exactly to confirm.",
        )

    result = await deletion.wipe(db, user.hotel_id, hotel.username or "")
    if not result.get("ok"):
        # The snapshot could not be taken, so nothing was deleted.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            result.get("error") or "Nothing was deleted.",
        )

    # EXPLICIT. `deletion.wipe` runs the DELETEs and leaves the transaction
    # open, and `audit_service.record` happens to commit — so this worked by
    # accident. A wipe that depends on its own audit line to be saved is one
    # refactor away from silently rolling back.
    await db.commit()

    # The ledger line is how the Control Room finds the snapshot later. Written
    # AFTER the wipe succeeded, because a line claiming a wipe that did not
    # happen would send somebody restoring over live data.
    await audit_service.record(
        db,
        hotel_id=user.hotel_id,
        user=user,
        action="hotel.wipe",
        # The snapshot key goes in the SUMMARY because that is the string a
        # human reads when somebody rings up asking for their data back.
        summary=(
            f"emptied the restaurant - {sum(result['removed'].values())} records "
            f"removed, snapshot {result['key']}"
        ),
        entity_type="hotel",
        entity_id=user.hotel_id,
    )
    return {
        "ok": True,
        "removed": result["removed"],
        "total": sum(result["removed"].values()),
        # Deliberately says who can undo it. Somebody who has just emptied
        # their restaurant by accident needs to know it is not gone.
        "note": (
            "Everything was saved first. If this was a mistake, DineAI support "
            "can put it back exactly as it was."
        ),
    }

@router.post("/onboarding/skip")
async def onboarding_skip(
    payload: _OnboardingChoice,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """Not for me. A restaurant with no chef does not need a Team step, and
    being asked again every visit is not helpfulness."""
    if not payload.step:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Which step?")
    saved = await onboarding._saved(db, user.hotel_id)
    skipped = sorted(set(saved.get("skipped") or []) | {payload.step})
    await onboarding.remember(db, user.hotel_id, skipped=skipped)
    return await onboarding.status(db, user.hotel_id)


@router.post("/onboarding/unskip")
async def onboarding_unskip(
    payload: _OnboardingChoice,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """Changed his mind. A skipped step is never hidden, only de-emphasised,
    so there is always something to press here."""
    if not payload.step:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Which step?")
    saved = await onboarding._saved(db, user.hotel_id)
    skipped = sorted(set(saved.get("skipped") or []) - {payload.step})
    await onboarding.remember(db, user.hotel_id, skipped=skipped)
    return await onboarding.status(db, user.hotel_id)


@router.post("/onboarding/snooze")
async def onboarding_snooze(
    payload: _OnboardingChoice,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """Not now. The dashboard card goes quiet; the page stays where it is.

    Distinct from dismiss on purpose. "Later" and "stop asking" are different
    intentions, and one button for both is wrong half the time.
    """
    until = (datetime.now(UTC) + timedelta(days=payload.days)).date().isoformat()
    await onboarding.remember(db, user.hotel_id, snoozed_until=until)
    return await onboarding.status(db, user.hotel_id)


@router.post("/onboarding/dismiss")
async def onboarding_dismiss(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """Stop showing me this. The sidebar entry stays — a restaurant that opens
    a second kitchen needs it back, and a door that vanishes is a door nobody
    can find again."""
    await onboarding.remember(db, user.hotel_id, dismissed=True)
    return await onboarding.status(db, user.hotel_id)


@router.post("/onboarding/resume")
async def onboarding_resume(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """Undo a dismissal or a snooze, from the onboarding page itself."""
    await onboarding.remember(db, user.hotel_id, dismissed=False, snoozed_until="")
    return await onboarding.status(db, user.hotel_id)


@router.post("/onboarding/at")
async def onboarding_at(
    payload: _OnboardingChoice,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """Remember which step he is on, so tomorrow opens where he stopped
    rather than at the beginning."""
    if not payload.step:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Which step?")
    await onboarding.remember(db, user.hotel_id, current_step=payload.step)
    return {"ok": True, "current_step": payload.step}
