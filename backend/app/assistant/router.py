"""Copilot endpoint. Any authenticated user may ask; tools enforce their own
permission + hotel scope, so answers never leak across roles or tenants."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import actions, ingest, provider, service
from app.assistant.provider import ProviderError
from app.assistant.schemas import (
    ActRequest,
    ActResult,
    ChatRequest,
    ChatResponse,
    IngestCommit,
    IngestPreview,
    IngestResult,
    UndoRequest,
)
from app.auth.deps import get_current_user
from app.auth.models import User
from app.core.database import get_db
from app.core.rbac import has_permission

router = APIRouter(prefix="/assistant", tags=["assistant"])

_MAX_MESSAGES = 24
_MAX_CHARS = 4000


@router.get("/status")
async def status_(user: User = Depends(get_current_user)) -> dict:
    """Whether the smart LLM is switched on (a key is configured)."""
    return {"configured": provider.is_configured()}


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatResponse:
    if not req.messages:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No message provided")
    if len(req.messages) > _MAX_MESSAGES:
        req.messages = req.messages[-_MAX_MESSAGES:]
    if any(len(m.content) > _MAX_CHARS for m in req.messages):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message too long")
    if req.attachment and len(req.attachment.data) > 20_000_000:  # ~15MB of base64
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Attachment too large")
    return await service.answer(db, user, req)


# ── Document onboarding ────────────────────────────────────────────────────────
@router.post("/ingest", response_model=IngestPreview)
async def ingest_extract(
    kind: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
) -> IngestPreview:
    """Read an uploaded PDF/image/CSV and return PROPOSED rows. Writes nothing."""
    perm = ingest.kind_perm(kind)
    if perm is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown document kind '{kind}'")
    if not has_permission(user.role, perm):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't add that kind of record")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > ingest.MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large (max 15MB)")
    mime = file.content_type or "application/pdf"
    try:
        rows = await ingest.extract(data, mime, kind)
    except ProviderError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The AI isn't switched on yet (no Gemini key), so I can't read documents.",
        ) from None
    return IngestPreview(kind=kind, rows=rows)


@router.post("/ingest/commit", response_model=IngestResult)
async def ingest_commit(
    payload: IngestCommit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> IngestResult:
    """Create the confirmed rows from a prior /ingest preview."""
    if not payload.rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No rows to add")
    result = await ingest.commit(db, user, payload.kind, payload.rows)
    if result.get("error"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, result["error"])
    return IngestResult(**result)


# ── Write actions (confirmed by the user, then executed) ──────────────────────
@router.post("/act", response_model=ActResult)
async def act(
    payload: ActRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ActResult:
    """Execute a confirmed proposal (add expense/sale/item/vendor)."""
    result = await actions.execute(db, user, payload.kind, payload.fields)
    if not result.get("ok"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, result.get("error", "Could not do that"))
    return ActResult(ok=True, summary=result["summary"], undo=result.get("undo"))


@router.post("/undo", response_model=ActResult)
async def undo(
    payload: UndoRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ActResult:
    """Reverse a just-performed AI action."""
    result = await actions.undo(db, user, payload.type, payload.id)
    if not result.get("ok"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, result.get("error", "Nothing to undo"))
    return ActResult(ok=True, summary=result["summary"])
