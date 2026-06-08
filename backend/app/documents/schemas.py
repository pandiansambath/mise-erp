"""Schemas for documents."""
import uuid
from datetime import date as date_type
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    doc_type: str
    related_entity_type: str | None
    related_entity_id: uuid.UUID | None
    expiry_date: date_type | None
    filename: str
    mime_type: str | None
    file_size: int
    uploaded_at: datetime


class ExpiringDoc(BaseModel):
    id: uuid.UUID
    title: str
    doc_type: str
    expiry_date: date_type
    days_left: int


class DocRequestCreate(BaseModel):
    employee_id: uuid.UUID
    doc_type: str = "EMPLOYEE_DOC"
    title: str = Field(min_length=1, max_length=200)


class DocRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str
    doc_type: str
    title: str
    status: str
    document_id: uuid.UUID | None
    created_at: datetime
