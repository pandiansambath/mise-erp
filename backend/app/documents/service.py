"""Document service: store file + metadata, list, download, expiry alerts."""
import uuid
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.storage import get_storage
from app.documents.models import Document


async def create_document(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    title: str,
    doc_type: str,
    filename: str,
    mime_type: str | None,
    data: bytes,
    related_entity_type: str | None = None,
    related_entity_id: uuid.UUID | None = None,
    expiry_date: date_type | None = None,
    uploaded_by: uuid.UUID | None = None,
) -> Document:
    doc = Document(
        hotel_id=hotel_id,
        title=title,
        doc_type=doc_type,
        filename=filename,
        mime_type=mime_type,
        file_size=len(data),
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        expiry_date=expiry_date,
        uploaded_by=uploaded_by,
        storage_key="",
    )
    db.add(doc)
    await db.flush()
    doc.storage_key = get_storage().save(hotel_id, doc.id, filename, data)
    await db.commit()
    await db.refresh(doc)
    return doc


async def get_document(db: AsyncSession, doc_id: uuid.UUID, hotel_id: uuid.UUID) -> Document | None:
    doc = await db.get(Document, doc_id)
    if doc is None or doc.hotel_id != hotel_id:
        return None
    return doc


async def list_documents(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    doc_type: str | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
) -> list[Document]:
    stmt = select(Document).where(Document.hotel_id == hotel_id)
    if doc_type:
        stmt = stmt.where(Document.doc_type == doc_type)
    if entity_type:
        stmt = stmt.where(Document.related_entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(Document.related_entity_id == entity_id)
    result = await db.execute(stmt.order_by(Document.uploaded_at.desc()))
    return list(result.scalars().all())


async def delete_document(db: AsyncSession, doc: Document) -> None:
    get_storage().delete(doc.storage_key)
    await db.delete(doc)
    await db.commit()


async def expiring(db: AsyncSession, hotel_id: uuid.UUID, within_days: int = 30) -> list[dict]:
    today = date_type.today()
    result = await db.execute(
        select(Document).where(
            Document.hotel_id == hotel_id, Document.expiry_date.is_not(None)
        )
    )
    out = []
    for d in result.scalars().all():
        days_left = (d.expiry_date - today).days
        if days_left <= within_days:
            out.append(
                {
                    "id": d.id,
                    "title": d.title,
                    "doc_type": d.doc_type,
                    "expiry_date": d.expiry_date,
                    "days_left": days_left,
                }
            )
    return sorted(out, key=lambda r: r["days_left"])
