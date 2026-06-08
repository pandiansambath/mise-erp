"""Document endpoints: upload, list, download, delete, expiry alerts. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.config import settings
from app.core.database import get_db
from app.core.storage import get_storage
from app.documents import service
from app.documents.schemas import DocumentOut, ExpiringDoc

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    doc_type: str = Form("OTHER"),
    title: str | None = Form(None),
    related_entity_type: str | None = Form(None),
    related_entity_id: uuid.UUID | None = Form(None),
    expiry_date: date_type | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:write")),
) -> DocumentOut:
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_mb} MB",
        )
    doc = await service.create_document(
        db, user.hotel_id,
        title=title or file.filename or "document",
        doc_type=doc_type,
        filename=file.filename or "document",
        mime_type=file.content_type,
        data=data,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        expiry_date=expiry_date,
        uploaded_by=user.id,
    )
    return DocumentOut.model_validate(doc)


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    doc_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:read")),
) -> list[DocumentOut]:
    docs = await service.list_documents(
        db, user.hotel_id, doc_type=doc_type, entity_type=entity_type, entity_id=entity_id
    )
    return [DocumentOut.model_validate(d) for d in docs]


@router.get("/expiring", response_model=list[ExpiringDoc])
async def expiring_documents(
    within_days: int = Query(default=30, ge=0, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:read")),
) -> list[ExpiringDoc]:
    rows = await service.expiring(db, user.hotel_id, within_days)
    return [ExpiringDoc.model_validate(d) for d in rows]


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:read")),
) -> Response:
    doc = await service.get_document(db, doc_id, user.hotel_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    try:
        data = get_storage().read(doc.storage_key)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File missing") from exc
    return Response(
        content=data,
        media_type=doc.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{doc.filename}"'},
    )


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:write")),
) -> None:
    doc = await service.get_document(db, doc_id, user.hotel_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    await service.delete_document(db, doc)
