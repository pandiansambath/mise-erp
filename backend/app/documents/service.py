"""Document service: store file + metadata, list, download, expiry alerts."""
import uuid
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.storage import get_storage
from app.documents.models import DocRequestStatus, Document, DocumentRequest
from app.employees.models import Employee


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


# ── Document requests (Super Admin asks an employee for a document) ──────────
async def create_request(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    employee_id: uuid.UUID,
    doc_type: str,
    title: str,
    requested_by: uuid.UUID | None = None,
) -> DocumentRequest:
    req = DocumentRequest(
        hotel_id=hotel_id,
        employee_id=employee_id,
        doc_type=doc_type,
        title=title,
        requested_by=requested_by,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


async def get_request(
    db: AsyncSession, request_id: uuid.UUID, hotel_id: uuid.UUID
) -> DocumentRequest | None:
    req = await db.get(DocumentRequest, request_id)
    if req is None or req.hotel_id != hotel_id:
        return None
    return req


async def list_requests(
    db: AsyncSession, hotel_id: uuid.UUID, *, employee_id: uuid.UUID | None = None
) -> list[dict]:
    stmt = (
        select(DocumentRequest, Employee)
        .join(Employee, DocumentRequest.employee_id == Employee.id)
        .where(DocumentRequest.hotel_id == hotel_id)
    )
    if employee_id is not None:
        stmt = stmt.where(DocumentRequest.employee_id == employee_id)
    rows = await db.execute(stmt.order_by(DocumentRequest.created_at.desc()))
    return [
        {
            "id": r.id,
            "employee_id": r.employee_id,
            "employee_name": e.full_name,
            "doc_type": r.doc_type,
            "title": r.title,
            "status": r.status,
            "document_id": r.document_id,
            "created_at": r.created_at,
        }
        for r, e in rows.all()
    ]


async def fulfil_request(
    db: AsyncSession,
    req: DocumentRequest,
    *,
    filename: str,
    mime_type: str | None,
    data: bytes,
    uploaded_by: uuid.UUID | None = None,
) -> Document:
    """Employee uploads the requested file → create a Document tagged to them,
    link it to the request, and mark it awaiting approval."""
    doc = await create_document(
        db,
        req.hotel_id,
        title=req.title,
        doc_type=req.doc_type,
        filename=filename,
        mime_type=mime_type,
        data=data,
        related_entity_type="EMPLOYEE",
        related_entity_id=req.employee_id,
        uploaded_by=uploaded_by,
    )
    req.document_id = doc.id
    req.status = DocRequestStatus.UPLOADED.value
    await db.commit()
    await db.refresh(req)
    return doc


async def set_request_status(
    db: AsyncSession, req: DocumentRequest, status: str
) -> DocumentRequest:
    req.status = status
    await db.commit()
    await db.refresh(req)
    return req


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
