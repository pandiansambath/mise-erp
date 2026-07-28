"""Copilot endpoint. Any authenticated user may ask; tools enforce their own
permission + hotel scope, so answers never leak across roles or tenants."""
import time
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import actions, guard, ingest, memory, provider, service
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
from app.audit import service as audit
from app.auth.deps import get_current_user, require, require_feature
from app.auth.models import User
from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import has_permission

# Whole Copilot is gated on the hotel's ai_copilot entitlement (Control Room toggle).
router = APIRouter(
    prefix="/assistant",
    tags=["assistant"],
    dependencies=[Depends(require_feature("ai_copilot"))],
)

_MAX_MESSAGES = 40  # keep more of the conversation so the assistant doesn't "forget"
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
    await guard.enforce(db, user, "chat")

    # Which conversation is this? The client sends one after the first reply;
    # before that we resume whatever they were last saying.
    thread_id = req.thread_id or await memory.latest_thread(db, user) or uuid.uuid4()
    asked = req.messages[-1].content if req.messages else ""
    await memory.remember(db, user, thread_id, "user", asked)

    started = time.monotonic()
    answer = await service.answer(db, user, req)
    await memory.remember(db, user, thread_id, "assistant", answer.reply)
    answer.thread_id = thread_id
    # tokens aren't reported back through the provider abstraction yet, so a chat
    # turn counts toward the request limits but contributes 0 to the token total
    await guard.record(
        db, user, kind="chat", model=settings.bedrock_model_id,
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    return answer


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
        if not provider.is_configured():
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "The AI isn't switched on yet (no Gemini key), so I can't read documents.",
            ) from None
        # The AI IS on — this was a transient failure (usually a rate limit).
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "The AI is busy right now (rate limit) — please try that again in a moment.",
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


# ── Claude on Bedrock: read a bill / handwritten recipe ───────────────────────
@router.get("/history")
async def history(
    thread: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Replay this person's conversation. Their own messages only — the query is
    scoped by user_id, so a guessed thread id returns nothing."""
    tid, msgs = await memory.load(db, user, thread)
    return {"thread_id": str(tid), "messages": msgs}


@router.post("/history/new")
async def new_thread(user: User = Depends(get_current_user)) -> dict:
    """Start a fresh conversation. Nothing is deleted — the old thread stays
    readable, and the assistant still gets a little context from it."""
    return {"thread_id": str(uuid.uuid4())}


@router.delete("/history/{thread_id}")
async def clear_thread(
    thread_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    removed = await memory.forget_thread(db, user, thread_id)
    return {"removed": removed}


@router.get("/usage")
async def usage(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    """This hotel's AI spend this month, and what's left of the allowance."""
    return await guard.summary(db, user)


@router.get("/vision/status")
async def vision_status(user: User = Depends(get_current_user)) -> dict:
    """Is the Bedrock brain switched on? (Drives the upload screen's banner.)"""
    from app.assistant import bedrock

    return bedrock.health()


@router.post("/vision/read")
async def vision_read(
    kind: str = Form("auto"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Photograph of a supplier bill or a handwritten recipe -> structured data.

    Proposes only: nothing is saved until a human confirms it on screen. The
    matching context is built from THIS hotel's items and vendors, so a hotel's
    AI can never see another's data.
    """
    from sqlalchemy import select

    from app.assistant import bedrock, guard
    from app.inventory.models import Item
    from app.vendors.models import Vendor

    # budget first: refuse before spending, never after
    await guard.enforce(db, user, "vision", feature="ai_scan")

    if kind not in ("auto", "bill", "recipe"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind must be auto, bill or recipe")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large (max 15MB)")
    media = (file.content_type or "image/jpeg").split(";")[0]
    if media not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Please upload a photo (JPEG, PNG, WEBP or GIF).",
        )

    items = (
        (
            await db.execute(
                select(Item).where(Item.hotel_id == user.hotel_id, Item.is_active.is_(True))
            )
        )
        .scalars()
        .all()
    )
    vendors = (
        (
            await db.execute(
                select(Vendor).where(Vendor.hotel_id == user.hotel_id, Vendor.is_active.is_(True))
            )
        )
        .scalars()
        .all()
    )

    meter: dict = {}
    started = time.monotonic()
    try:
        result = bedrock.understand_document(
            data,
            media,
            kind=kind,
            known_items=[{"id": str(i.id), "name": i.name, "unit": i.unit} for i in items],
            known_vendors=[v.name for v in vendors],
            meter=meter,
            model=await guard.model_for(db, user),
        )
    except bedrock.BedrockUnavailable as exc:
        await guard.record(
            db, user, kind="vision", model=meter.get("model", ""),
            latency_ms=int((time.monotonic() - started) * 1000), ok=False,
        )
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None

    await guard.record(
        db, user, kind="vision",
        model=meter.get("model", ""),
        input_tokens=meter.get("input_tokens", 0),
        output_tokens=meter.get("output_tokens", 0),
        latency_ms=int((time.monotonic() - started) * 1000),
    )

    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="ai.read_document",
        summary=f"Read a {result.get('doc_type', kind)} with the AI (nothing saved yet)",
        entity_type="document", entity_id=None,
    )
    return result


class VisionCommitLine(BaseModel):
    """One approved line from a scanned bill (already human-checked)."""

    name: str = Field(max_length=200)
    qty: float | None = None
    unit: str | None = None
    line_total: float | None = None


class VisionCommit(BaseModel):
    vendor_name: str | None = Field(default=None, max_length=120)
    date: str | None = None
    total: float = Field(gt=0)
    category: str = Field(default="Food", max_length=60)
    lines: list[VisionCommitLine] = Field(default_factory=list)


@router.post("/vision/commit")
async def vision_commit(
    payload: VisionCommit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:write")),
) -> dict:
    """Write an APPROVED scanned bill into Expenses.

    Deliberately separate from /vision/read: the AI only ever proposes, and this
    runs solely on what a human confirmed on screen.
    """
    from datetime import date as date_type

    from sqlalchemy import select

    from app.expenses.models import ExpenseCategory
    from app.expenses.service import create_expense

    when = date_type.today()
    if payload.date:
        try:
            when = date_type.fromisoformat(payload.date[:10])
        except ValueError:
            pass  # an unreadable date falls back to today rather than failing

    cat = (
        await db.execute(
            select(ExpenseCategory).where(
                ExpenseCategory.hotel_id == user.hotel_id,
                func.lower(ExpenseCategory.name) == payload.category.strip().lower(),
            )
        )
    ).scalars().first()
    if cat is None:
        cat = ExpenseCategory(
            hotel_id=user.hotel_id, name=payload.category.strip() or "Food", kind="VARIABLE"
        )
        db.add(cat)
        await db.flush()

    bits = [payload.vendor_name or "Scanned bill"]
    if payload.lines:
        bits.append(f"{len(payload.lines)} item{'s' if len(payload.lines) != 1 else ''}")
    exp = await create_expense(
        db,
        user.hotel_id,
        category_id=cat.id,
        date=when,
        amount=Decimal(str(payload.total)),
        payment_method="CASH",
        description=" · ".join(bits) + " [ai-scan]",
    )
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="ai.commit_bill",
        summary=f"Scanned bill saved: {payload.vendor_name or 'unknown vendor'} {payload.total}",
        entity_type="expense", entity_id=exp.id,
    )
    return {"expense_id": str(exp.id), "amount": str(exp.amount), "date": str(exp.date)}
