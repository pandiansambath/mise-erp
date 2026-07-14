"""Job portal routers.

`router`        — hotel side (auth): manage postings + applicant pipeline.
`public_router` — the public board (NO auth): list/read OPEN postings, apply
                  with a resume. Uploads are size/type-guarded.
"""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core import notify
from app.core.config import settings
from app.core.database import get_db
from app.core.storage import get_storage
from app.hotels.models import Hotel
from app.jobs.models import ApplicationStatus, JobApplication, JobPosting, JobStatus
from app.jobs.schemas import (
    EMPLOYMENT_TYPES,
    ApplicationOut,
    ApplicationPatch,
    PostingIn,
    PostingOut,
    PostingPatch,
    PublicPosting,
    PublicPostingDetail,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])
public_router = APIRouter(prefix="/public/jobs", tags=["jobs-public"])

RESUME_EXTS = {".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg"}
RESUME_MAX_MB = 5


async def _get_posting(db: AsyncSession, posting_id: uuid.UUID, hotel_id: uuid.UUID) -> JobPosting:
    posting = (
        await db.execute(
            select(JobPosting).where(JobPosting.id == posting_id, JobPosting.hotel_id == hotel_id)
        )
    ).scalar_one_or_none()
    if not posting:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Posting not found")
    return posting


def _counts_map(rows: list[tuple[uuid.UUID, str, int]]) -> dict[uuid.UUID, dict[str, int]]:
    out: dict[uuid.UUID, dict[str, int]] = {}
    for pid, st, n in rows:
        d = out.setdefault(pid, {"total": 0, "new": 0})
        d["total"] += n
        if st == ApplicationStatus.NEW.value:
            d["new"] += n
    return out


# ── hotel side ───────────────────────────────────────────────────────────────
@router.get("", response_model=list[PostingOut])
async def list_postings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[PostingOut]:
    postings = (
        (
            await db.execute(
                select(JobPosting)
                .where(JobPosting.hotel_id == user.hotel_id)
                .order_by(JobPosting.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    counts = _counts_map(
        (
            await db.execute(
                select(
                    JobApplication.posting_id, JobApplication.status, func.count(JobApplication.id)
                )
                .where(JobApplication.hotel_id == user.hotel_id)
                .group_by(JobApplication.posting_id, JobApplication.status)
            )
        ).all()
    )
    out = []
    for p in postings:
        row = PostingOut.model_validate(p)
        c = counts.get(p.id, {"total": 0, "new": 0})
        row.applications = c["total"]
        row.new_applications = c["new"]
        out.append(row)
    return out


@router.post("", response_model=PostingOut, status_code=status.HTTP_201_CREATED)
async def create_posting(
    payload: PostingIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> PostingOut:
    if payload.employment_type not in EMPLOYMENT_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown employment type")
    hotel = (await db.execute(select(Hotel).where(Hotel.id == user.hotel_id))).scalar_one()
    posting = JobPosting(
        hotel_id=user.hotel_id,
        title=payload.title,
        department=payload.department,
        employment_type=payload.employment_type,
        salary_text=payload.salary_text,
        location=payload.location or hotel.city,
        description=payload.description,
        closes_on=payload.closes_on,
        created_by=user.id,
    )
    db.add(posting)
    await db.commit()
    await db.refresh(posting)
    return PostingOut.model_validate(posting)


@router.patch("/{posting_id}", response_model=PostingOut)
async def update_posting(
    posting_id: uuid.UUID,
    payload: PostingPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> PostingOut:
    posting = await _get_posting(db, posting_id, user.hotel_id)
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in (JobStatus.OPEN.value, JobStatus.CLOSED.value):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Status must be OPEN or CLOSED")
    if "employment_type" in data and data["employment_type"] not in EMPLOYMENT_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown employment type")
    for k, v in data.items():
        setattr(posting, k, v)
    await db.commit()
    await db.refresh(posting)
    return PostingOut.model_validate(posting)


@router.delete("/{posting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_posting(
    posting_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> None:
    posting = await _get_posting(db, posting_id, user.hotel_id)
    await db.delete(posting)
    await db.commit()


@router.get("/{posting_id}/applications", response_model=list[ApplicationOut])
async def list_applications(
    posting_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[ApplicationOut]:
    await _get_posting(db, posting_id, user.hotel_id)
    apps = (
        (
            await db.execute(
                select(JobApplication)
                .where(JobApplication.posting_id == posting_id)
                .order_by(JobApplication.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [ApplicationOut.model_validate(a) for a in apps]


@router.patch("/applications/{application_id}", response_model=ApplicationOut)
async def update_application(
    application_id: uuid.UUID,
    payload: ApplicationPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> ApplicationOut:
    app_row = (
        await db.execute(
            select(JobApplication).where(
                JobApplication.id == application_id, JobApplication.hotel_id == user.hotel_id
            )
        )
    ).scalar_one_or_none()
    if not app_row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found")
    if payload.status not in {s.value for s in ApplicationStatus}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown status")
    app_row.status = payload.status
    await db.commit()
    await db.refresh(app_row)
    return ApplicationOut.model_validate(app_row)


@router.get("/applications/{application_id}/resume")
async def download_resume(
    application_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    app_row = (
        await db.execute(
            select(JobApplication).where(
                JobApplication.id == application_id, JobApplication.hotel_id == user.hotel_id
            )
        )
    ).scalar_one_or_none()
    if not app_row or not app_row.resume_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No resume on this application")
    data = get_storage().read(app_row.resume_key)
    fname = app_row.resume_filename or "resume"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── the public board (no auth) ───────────────────────────────────────────────
@public_router.get("", response_model=list[PublicPosting])
async def public_list(db: AsyncSession = Depends(get_db)) -> list[PublicPosting]:
    rows = (
        await db.execute(
            select(JobPosting, Hotel.name, Hotel.city, Hotel.country)
            .join(Hotel, Hotel.id == JobPosting.hotel_id)
            .where(JobPosting.status == JobStatus.OPEN.value)
            .order_by(JobPosting.created_at.desc())
        )
    ).all()
    return [
        PublicPosting(
            id=p.id, title=p.title, hotel_name=name, city=city, country=country,
            department=p.department, employment_type=p.employment_type,
            salary_text=p.salary_text, location=p.location or city, created_at=p.created_at,
        )
        for p, name, city, country in rows
    ]


@public_router.get("/{posting_id}", response_model=PublicPostingDetail)
async def public_detail(
    posting_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> PublicPostingDetail:
    row = (
        await db.execute(
            select(JobPosting, Hotel.name, Hotel.city, Hotel.country)
            .join(Hotel, Hotel.id == JobPosting.hotel_id)
            .where(JobPosting.id == posting_id, JobPosting.status == JobStatus.OPEN.value)
        )
    ).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This vacancy is no longer open")
    p, name, city, country = row
    return PublicPostingDetail(
        id=p.id, title=p.title, hotel_name=name, city=city, country=country,
        department=p.department, employment_type=p.employment_type,
        salary_text=p.salary_text, location=p.location or city, created_at=p.created_at,
        description=p.description, closes_on=p.closes_on,
    )


@public_router.post("/{posting_id}/apply", status_code=status.HTTP_201_CREATED)
async def public_apply(
    posting_id: uuid.UUID,
    applicant_name: str = Form(..., min_length=2, max_length=120),
    email: str = Form(..., min_length=5, max_length=200),
    phone: str | None = Form(None),
    cover_note: str | None = Form(None),
    resume: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    posting = (
        await db.execute(
            select(JobPosting).where(
                JobPosting.id == posting_id, JobPosting.status == JobStatus.OPEN.value
            )
        )
    ).scalar_one_or_none()
    if not posting:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This vacancy is no longer open")

    application = JobApplication(
        posting_id=posting.id,
        hotel_id=posting.hotel_id,
        applicant_name=applicant_name.strip(),
        email=email.strip().lower(),
        phone=(phone or "").strip() or None,
        cover_note=(cover_note or "").strip() or None,
    )
    if resume is not None and resume.filename:
        ext = ("." + resume.filename.rsplit(".", 1)[-1].lower()) if "." in resume.filename else ""
        if ext not in RESUME_EXTS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Resume must be PDF, Word or an image"
            )
        data = await resume.read()
        if len(data) > RESUME_MAX_MB * 1024 * 1024:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Resume exceeds {RESUME_MAX_MB} MB"
            )
        application.resume_key = get_storage().save(
            posting.hotel_id, application.id, resume.filename, data
        )
        application.resume_filename = resume.filename
    db.add(application)
    await db.commit()
    # Heads-up to the hiring team (their Settings → Email alerts toggle decides).
    await notify.email_hotel_admins(
        db,
        posting.hotel_id,
        f"New applicant for {posting.title}: {application.applicant_name}",
        f"{application.applicant_name} just applied for '{posting.title}'. "
        f"Review the application in Mise → Hiring.",
        html=notify.render_email(
            badge="🧑‍🍳 New applicant",
            heading="Someone wants to join your team!",
            intro=f"Your <b>{posting.title}</b> vacancy is doing its job — a fresh "
            "application just landed in your pipeline. Great teams are built on "
            "quick replies, so strike while it's hot.",
            rows=[
                ("Applicant", application.applicant_name),
                ("Role", posting.title),
                ("Email", application.email),
                ("CV attached", "Yes" if application.resume_key else "No"),
            ],
            cta_label="Open the pipeline",
            cta_url=f"{settings.app_base_url}/hiring",
        ),
        pref_key="job_application",
        background=True,
    )
    return {"ok": True, "message": "Application received — the team will be in touch."}
