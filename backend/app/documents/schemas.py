"""Schemas for documents."""
import uuid
from datetime import date as date_type
from datetime import datetime

from pydantic import BaseModel, ConfigDict


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
