"""Schemas for the job portal (hotel side + public board)."""
import uuid
from datetime import date as date_type
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

EMPLOYMENT_TYPES = ("FULL_TIME", "PART_TIME", "CASUAL", "APPRENTICESHIP")


class PostingIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    department: str | None = Field(default=None, max_length=100)
    employment_type: str = "FULL_TIME"
    salary_text: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=120)
    description: str = ""
    closes_on: date_type | None = None


class PostingPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    department: str | None = None
    employment_type: str | None = None
    salary_text: str | None = None
    location: str | None = None
    description: str | None = None
    closes_on: date_type | None = None
    status: str | None = None  # OPEN | CLOSED


class PostingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    department: str | None
    employment_type: str
    salary_text: str | None
    location: str | None
    description: str
    status: str
    closes_on: date_type | None
    created_at: datetime
    # enriched by the router
    applications: int = 0
    new_applications: int = 0


class PublicPosting(BaseModel):
    """What the public board shows — no internal ids beyond the posting's."""

    id: uuid.UUID
    title: str
    hotel_name: str
    city: str | None
    country: str | None
    department: str | None
    employment_type: str
    salary_text: str | None
    location: str | None
    created_at: datetime


class PublicPostingDetail(PublicPosting):
    description: str
    closes_on: date_type | None


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    posting_id: uuid.UUID
    applicant_name: str
    email: str
    phone: str | None
    cover_note: str | None
    resume_filename: str | None
    status: str
    created_at: datetime


class ApplicationPatch(BaseModel):
    status: str  # NEW | SHORTLISTED | INTERVIEWED | HIRED | REJECTED
