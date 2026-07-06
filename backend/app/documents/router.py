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

from app.auth.deps import require, require_feature
from app.auth.models import User
from app.core.config import settings
from app.core.database import get_db
from app.core.storage import get_storage
from app.documents import service
from app.documents.models import DocRequestStatus
from app.documents.schemas import DocRequestCreate, DocRequestOut, DocumentOut, ExpiringDoc
from app.employees import service as emp_service

router = APIRouter(
    prefix="/documents", tags=["documents"],
    dependencies=[Depends(require_feature("documents"))],
)


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


# ── Document requests (Super Admin → employee) ───────────────────────────────
@router.post("/requests", response_model=DocRequestOut, status_code=status.HTTP_201_CREATED)
async def create_doc_request(
    payload: DocRequestCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:write")),
) -> DocRequestOut:
    emp = await emp_service.get_employee(db, payload.employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    await service.create_request(
        db, user.hotel_id,
        employee_id=payload.employee_id, doc_type=payload.doc_type,
        title=payload.title, requested_by=user.id,
    )
    rows = await service.list_requests(db, user.hotel_id, employee_id=payload.employee_id)
    return DocRequestOut.model_validate(rows[0])


@router.get("/requests", response_model=list[DocRequestOut])
async def list_doc_requests(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:read")),
) -> list[DocRequestOut]:
    rows = await service.list_requests(db, user.hotel_id)
    return [DocRequestOut.model_validate(r) for r in rows]


@router.post("/requests/{request_id}/approve", response_model=DocRequestOut)
async def approve_doc_request(
    request_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:write")),
) -> DocRequestOut:
    req = await service.get_request(db, request_id, user.hotel_id)
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    await service.set_request_status(db, req, DocRequestStatus.APPROVED.value)
    rows = await service.list_requests(db, user.hotel_id, employee_id=req.employee_id)
    return DocRequestOut.model_validate(next(r for r in rows if r["id"] == request_id))


@router.post("/requests/{request_id}/upload", response_model=DocRequestOut)
async def admin_fulfil_request(
    request_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("documents:write")),
) -> DocRequestOut:
    """Super Admin uploads the requested file ON BEHALF of the staff member
    (e.g. when the employee can't do it themselves). Same as the staff upload,
    just initiated from the admin side."""
    req = await service.get_request(db, request_id, user.hotel_id)
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB"
        )
    await service.fulfil_request(
        db, req,
        filename=file.filename or "document",
        mime_type=file.content_type,
        data=data,
        uploaded_by=user.id,
    )
    rows = await service.list_requests(db, user.hotel_id, employee_id=req.employee_id)
    return DocRequestOut.model_validate(next(r for r in rows if r["id"] == request_id))


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
