"""Schemas for the audit trail."""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_email: str
    action: str
    summary: str
    entity_type: str | None
    created_at: datetime
