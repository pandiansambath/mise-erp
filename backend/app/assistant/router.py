"""Copilot endpoint. Any authenticated user may ask; tools enforce their own
permission + hotel scope, so answers never leak across roles or tenants."""
import asyncio
import base64
import json
import logging
import time
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import (
    actions,
    docbytes,
    guard,
    ingest,
    memory,
    provider,
    service,
    tools,
)
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
from app.core import list_io, lists
from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import has_permission

# Whole Copilot is gated on the hotel's ai_copilot entitlement (Control Room toggle).
log = logging.getLogger("mise.assistant.router")

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
    await memory.touch_thread(db, user, thread_id, asked)
    await memory.remember(db, user, thread_id, "user", asked)

    started = time.monotonic()
    answer = await service.answer(db, user, req)
    await memory.remember(db, user, thread_id, "assistant", answer.reply)
    answer.thread_id = thread_id
    # The provider abstraction reports no token usage, so estimate what actually
    # went over the wire. An approximate number that moves beats an exact zero.
    sent = sum(guard.estimate_tokens(m.content) for m in req.messages)
    await guard.record(
        db, user, kind="chat", model=settings.bedrock_model_id,
        input_tokens=sent + guard.SYSTEM_PROMPT_TOKENS,
        output_tokens=guard.estimate_tokens(answer.reply),
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    return answer


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """The same turn as /chat, sent as server-sent events while it happens.

    The owner's complaint was not that answers were wrong, it was that fifteen
    silent seconds are indistinguishable from a hang. This sends what the
    assistant is doing as it does it, then the reply as it is written.

    A POST rather than an EventSource, deliberately: EventSource cannot send a
    body or an Authorization header, and the alternative — a token in the query
    string — puts credentials in logs and browser history for a feature whose
    only job is cosmetic.

    Every guard from /chat applies first. Streaming must not become the cheap
    door into the expensive thing.
    """
    if not req.messages:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No message provided")
    if len(req.messages) > _MAX_MESSAGES:
        req.messages = req.messages[-_MAX_MESSAGES:]
    if any(len(m.content) > _MAX_CHARS for m in req.messages):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message too long")
    if req.attachment and len(req.attachment.data) > 20_000_000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Attachment too large")
    await guard.enforce(db, user, "chat")

    thread_id = req.thread_id or await memory.latest_thread(db, user) or uuid.uuid4()
    asked = req.messages[-1].content if req.messages else ""
    await memory.touch_thread(db, user, thread_id, asked)
    await memory.remember(db, user, thread_id, "user", asked)
    started = time.monotonic()

    async def events():
        reply_text = ""
        try:
            async for ev in service.answer_stream(db, user, req):
                if ev.get("type") == "done":
                    payload = ev.get("response") or {}
                    payload["thread_id"] = str(thread_id)
                    reply_text = payload.get("reply", "")
                    yield f"data: {json.dumps({'type': 'done', 'response': payload})}\n\n"
                else:
                    yield f"data: {json.dumps(ev)}\n\n"
        except Exception as exc:  # noqa: BLE001
            log.warning("chat stream failed", exc_info=True)
            # An error the user can read beats a socket that just closes.
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)[:200]})}\n\n"
        finally:
            # Persist and meter whatever was produced, even on a broken stream:
            # tokens were spent either way, and a half-answer the user saw
            # should still be in the thread when they come back.
            if reply_text:
                await memory.remember(db, user, thread_id, "assistant", reply_text)
            sent = sum(guard.estimate_tokens(m.content) for m in req.messages)
            await guard.record(
                db, user, kind="chat", model=settings.bedrock_model_id,
                input_tokens=sent + guard.SYSTEM_PROMPT_TOKENS,
                output_tokens=guard.estimate_tokens(reply_text),
                latency_ms=int((time.monotonic() - started) * 1000),
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            # Without this an nginx-style proxy buffers the whole response and
            # delivers it at the end — which is precisely the behaviour this
            # endpoint exists to remove.
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
        rows = await ingest.extract(data, mime, kind, file.filename or "")
    except ProviderError:
        if not provider.is_configured():
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "The AI can't be reached right now, so I can't read documents.",
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


@router.get("/threads")
async def threads(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    """This person's conversations, newest first — the sidebar list."""
    return {"threads": await memory.list_threads(db, user)}


class RenameThread(BaseModel):
    title: str = Field(max_length=120)


@router.patch("/threads/{thread_id}")
async def rename_thread(
    thread_id: uuid.UUID,
    body: RenameThread,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Auto-titles are a good guess, not always the right one."""
    ok = await memory.rename_thread(db, user, thread_id, body.title)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return {"ok": True}


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


@router.get("/insights")
async def insights(
    refresh: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Today's briefing. Generated at most once a day per hotel, so opening the
    dashboard repeatedly is free — this would otherwise be the most expensive
    screen in the product."""
    from app.assistant import insights as ins

    try:
        return await ins.daily(db, user, force=refresh)
    except guard.AiQuotaExceeded as exc:
        # not on this plan, or out of allowance — say so quietly rather than
        # breaking the dashboard for everyone on Starter
        return {"insights": [], "unavailable": True, "reason": exc.detail}


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

    if kind not in ("auto", "bill", "recipe", "menu"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind must be auto, bill, recipe or menu")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large (max 15MB)")
    # WHATEVER THEY HAVE, NOT WHATEVER WE PREFER.
    #
    #     "also it only accpeintg images png...whats the hell it need to
    #      acceppt litrelly all type of dcouements"
    #
    # He uploaded a spreadsheet of suppliers and was told "Please upload a
    # photo (JPEG, PNG, WEBP or GIF)". A restaurant's data arrives as whatever
    # it arrives as — a photo of a stock sheet, a supplier's PDF, a CSV this
    # product exported ten minutes earlier — and the job of this endpoint is to
    # work out what it is, not to have a preference.
    #
    # The list is a DENY of things we genuinely cannot read, not an ALLOW of
    # four image types: `ingest.extract` handles text, spreadsheets, PDFs and
    # images, and an unknown type is better attempted than refused, because the
    # model will say so itself if it cannot read it.
    media = (file.content_type or "").split(";")[0]
    name = (file.filename or "").lower()
    unreadable = (".zip", ".exe", ".dmg", ".mp4", ".mov", ".mp3", ".wav")
    if name.endswith(unreadable):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "That looks like an archive or a media file. Send a document, a "
            "spreadsheet or a photograph.",
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
            # THE SUFFIX, because the content type lies. A .csv this product
            # exported and he re-uploaded from Windows arrives as
            # application/octet-stream, which reads as neither text nor image.
            filename=file.filename or "",
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


@router.post("/read-any")
async def read_any_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Read ANY document and say which list it is, as a reviewable plan.

        "ai will play big role here as it wil dected whatever the doc or images
         or ahwtever it is it need to analyse and do the needefulll"

    This is the fallback behind `/setup`'s one drop rail. A file whose column
    headings we recognise never reaches here — that path is exact and free.
    This is for the rest: a supplier's PDF, a photographed stock sheet, a
    spreadsheet with somebody else's headings.

    IT RETURNS A PLAN, NOT A RESULT. The rows go through the same `classify`
    the file importers use, against the same existing records, and come back
    on the same preview screen. So the AI route cannot write something the
    file route would have shown you first — there is no second commit path to
    keep in step, because the commit is `/{list}/import/commit`, which already
    re-checks everything at write time.
    """
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > ingest.MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large (max 15MB)")
    if docbytes.is_unreadable(file.filename or ""):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "That looks like an archive or a media file. Send a document, a "
            "spreadsheet or a photograph.",
        )

    meter: dict = {}
    started = time.monotonic()
    try:
        slug, rows = await ingest.read_any(
            data, file.content_type or "", file.filename or ""
        )
    except ProviderError:
        await guard.record(
            db, user, kind="vision", model=meter.get("model", ""),
            latency_ms=int((time.monotonic() - started) * 1000), ok=False,
        )
        if not provider.is_configured():
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "The AI can't be reached right now, so I can't read documents.",
            ) from None
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "The AI is busy right now — please try that again in a moment.",
        ) from None

    await guard.record(
        db, user, kind="vision", model=meter.get("model", ""),
        latency_ms=int((time.monotonic() - started) * 1000),
    )

    if slug is None or not rows:
        # NOT AN ERROR. A person can upload their gas bill, and being told
        # plainly that this is not one of the four lists beats a 400.
        return {"list": None, "plan": None, "why": (
            "I read that, but it isn't a list of suppliers, staff, stock or "
            "menu dishes. If it is one of those, open that page and use "
            "Import there — the columns will tell me what I'm looking at."
        )}

    # PERMISSION IS CHECKED AFTER WE KNOW WHAT IT IS, and before anything is
    # returned. The same table the assistant's bulk tool uses, so a list is
    # unreachable here the moment it is unreachable there.
    perm = tools._LIST_WRITE_PERM.get(slug)
    if perm is None or not has_permission(user.role, perm):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"That looks like a {slug} list, and you don't have permission to add those.",
        )

    rows = rows[:tools.MAX_LIST_ROWS]
    spec = lists.EXPORTABLE[slug]
    allowed = {f.key for f in spec.fields}
    cleaned = [{k: v for k, v in r.items() if k in allowed} for r in rows]

    existing = await tools._existing_for(db, user, slug)
    plan = list_io.classify(cleaned, spec, existing)

    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="ai.read_any",
        summary=f"AI read a document as {slug} ({len(cleaned)} rows, nothing saved yet)",
    )
    return {"list": slug, "label": spec.name, "plan": plan.as_dict()}


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


class KioskQuoteIn(BaseModel):
    on: str = ""


class VoiceTurnIn(BaseModel):
    """One thing the owner said out loud."""

    text: str = Field(min_length=1, max_length=2000)
    history: list[dict] = Field(default_factory=list)
    #: Which page he is looking at, so "put it in here" means something.
    route: str | None = None
    #: Which conversation this belongs to. Spoken turns were held in React
    #: state and nowhere else, so a conversation on his phone did not exist on
    #: his laptop - and closing the panel lost it entirely. It is the same
    #: thread store the written chat uses; there was never a reason for the
    #: voice to have its own memory, or none.
    thread_id: str | None = None
    #: Which of the six voices to answer in. The browser has always sent this
    #: and the schema did not declare it, so pydantic dropped it on the floor
    #: and `payload.voice` raised on every single streamed turn. Same family of
    #: fault as the response_model that strips undeclared fields - a field that
    #: quietly is not there, failing far from where it was omitted.
    voice: str = "Amy"
    #: Did he SAY this, or type it?
    #:
    #: Typing is not a request to be spoken to. The same brain answers either
    #: way, but a typed question used to come back as speech out of the
    #: laptop, unasked — and generating it cost a Polly call and the latency
    #: for audio nobody had asked for. Defaults true so an older client that
    #: does not send it behaves as it always did.
    speak: bool = True


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    voice: str = "Amy"


# ── 🎙️ THE VOICE ────────────────────────────────────────────────────────────
@router.get("/voice/voices")
async def voice_options(_: User = Depends(get_current_user)) -> dict:
    """The six voices, named the way a person would pick one."""
    from app.assistant.voice import DEFAULT_VOICE, VOICES

    return {"voices": VOICES, "default": DEFAULT_VOICE}


@router.post("/voice/turn")
async def voice_turn(
    payload: "VoiceTurnIn",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """One spoken turn: hear it, think, answer, and maybe ask the PAGE to move.

    Nothing here writes. If the owner says "put a 120 pound cash sale in", the
    reply carries an action telling the browser to open Sales and fill the form
    - and the form saves it exactly as it would if he had typed it, with the
    same permission check and the same confirm. A spoken instruction is a
    request, not a password.
    """
    from app.assistant import brain, guard, voice
    from app.assistant.tools import EXECUTORS
    from app.hotels.models import Hotel

    await guard.enforce(db, user, "chat", feature="ai_copilot")
    hotel = await db.get(Hotel, user.hotel_id)

    actions: list[dict] = []

    async def execute(name: str, args: dict) -> dict:
        # The two UI tools never reach the database - they are messages to the
        # browser. Everything else is an ordinary read tool, scoped to this
        # person exactly as it is when they type.
        ui = voice.action_from(name, args)
        if ui is not None:
            actions.append(ui)
            return {"ok": True, "note": "The page is doing that now."}
        fn = EXECUTORS.get(name)
        if fn is None:
            return {"error": f"unknown tool {name}"}
        try:
            out = await fn(db, user, args)
        except Exception:  # noqa: BLE001 - one bad tool must not end the answer
            log.exception("voice tool %s failed", name)
            return {"error": f"The {name} lookup failed just then."}
        # Same rule as the streaming path: a rule enforced in one of two
        # executors holds only for whoever happens not to use the other.
        return await _voice_commit(db, user, name, out)

    system = (
        voice.PERSONA
        + f"\n\nYou are in {hotel.name if hotel else 'this restaurant'}."
        + (f" They are looking at the {payload.route} page." if payload.route else "")
        + f"\n\nThe person you are talking to is a {user.role}."
    )

    meter: dict = {}
    try:
        reply, _used = await brain.generate(
            system=system,
            history=[
                *voice.history_for(payload.history),
                {"role": "user", "content": voice.with_route(payload.text, payload.route)},
            ],
            tools=voice.tools_for_voice(user),
            execute=execute,
            model=await guard.model_for(db, user),
            meter=meter,
        )
    except Exception as exc:  # noqa: BLE001 - he is standing there waiting
        log.exception("voice turn failed")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "I could not hear that properly just then.",
        ) from exc

    await guard.record(
        db, user, kind="chat", model=meter.get("model", ""),
        input_tokens=meter.get("input_tokens", 0),
        output_tokens=meter.get("output_tokens", 0),
    )
    return {
        "reply": reply,
        "spoken": voice.spoken_form(reply),
        "actions": actions,
    }


def _sse(event: dict) -> str:
    """One server-sent event, in the shape the frontend already parses."""
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.get("/voice/hello")
async def voice_hello(
    voice_id: str = "Amy",
    user: User = Depends(get_current_user),
) -> dict:
    """What it says when he opens the panel, before he has said anything.

    "once user click the voice model that model need to start the conversation
     ... it can even do action ... this voice model need to guide and initiate
     conversation."

    He is right that an assistant which waits to be spoken to first is a strange
    thing to build. This is deliberately NOT a model call: it must be instant
    and free, it is the same handful of sentences either way, and spending a
    Bedrock turn on "hello" would put a two-second pause on opening a panel.
    """
    from app.assistant import voice

    line = voice.greeting()
    audio = ""
    try:
        raw = await run_in_threadpool(voice.speak, line, voice_id)
        audio = base64.b64encode(raw).decode("ascii")
    except Exception:  # noqa: BLE001 - a silent hello still reads fine
        log.exception("greeting audio failed")
    return {"text": line, "audio": audio}


@router.get("/voice/listen-url")
async def voice_listen_url(
    language: str = "en-GB",
    user: User = Depends(get_current_user),
) -> dict:
    """A signed WebSocket the browser may open to Amazon Transcribe.

    "tried voice model..still its not listenig the voice"

    Brave ships the browser speech API and blocks the Google service behind it,
    so our voice was taking the blame for a browser decision. This moves the
    ears onto our own stack - and the browser opens the socket ITSELF, so no
    audio passes through this box. An always-on microphone proxied through a
    t3.micro would be a permanent audio stream per user.

    The credential never leaves the server; the browser gets a signature that
    expires in five minutes and permits nothing but transcription.
    """
    from app.assistant import listen

    try:
        url = await run_in_threadpool(listen.presigned_url, language)
    except Exception as exc:  # noqa: BLE001
        log.exception("could not sign a transcribe url")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "I can't reach the transcription service right now.",
        ) from exc
    return {"url": url, "sample_rate": listen.SAMPLE_RATE}


@router.post("/voice/stream")
async def voice_stream(
    payload: "VoiceTurnIn",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """One spoken turn, sent out in pieces the moment each piece exists.

    The old path was two requests in series and nothing began until everything
    had finished: 5.4s to write the reply, then another 2.4s to synthesise it,
    then it spoke. Nearly eight seconds of silence with a person standing
    there. Measured, on the live box, not guessed.

    This changes the ORDER, not the brain. Same model, same tools, same
    answers - but the text goes out as it is written, the page starts moving
    the instant the model asks for it, and the first sentence is already coming
    out of Polly while the second is still being thought of.

    Events: `delta` (text as written), `action` (navigate/fill, immediately),
    `audio` (base64 mp3 per sentence, in order), `done`, `error`.
    """
    from app.assistant import brain, guard, voice
    from app.assistant.tools import EXECUTORS
    from app.hotels.models import Hotel

    await guard.enforce(db, user, "chat", feature="ai_assistant")
    hotel = await db.get(Hotel, user.hotel_id)
    system = await voice.system_for(db, user, hotel, payload.route)

    # The conversation lives on the server, like the written one.
    from app.assistant import memory as mem

    try:
        thread_id = uuid.UUID(payload.thread_id) if payload.thread_id else None
    except ValueError:
        thread_id = None
    if thread_id is None:
        thread_id = await mem.latest_thread(db, user) or uuid.uuid4()

    async def _save_question() -> None:
        """Write his question down. Deliberately NOT awaited before the model.

        Persisting the conversation put two database round trips in front of
        every spoken turn — in front of the one number he actually feels, which
        is how long he stands there before it says anything. The record matters;
        it does not matter BEFORE the answer starts.
        """
        try:
            await mem.touch_thread(db, user, thread_id, payload.text)
            await mem.remember(db, user, thread_id, "user", payload.text)
        except Exception:  # noqa: BLE001 - a lost log line must not cost a reply
            log.exception("could not store the question")
    model = await guard.model_for(db, user)
    chosen_voice = payload.voice or voice.DEFAULT_VOICE

    # `generate_stream` yields its `tool` event BEFORE running the tool, so the
    # result never rides on the event. The executor drops UI actions here and
    # the loop drains them on its next pass — which is the first moment the
    # action is knowable at all.
    ui_queue: list[dict] = []
    # Asking the same question twice does not make the answer arrive. Observed
    # on prod: query_data called three times with identical arguments, the lap
    # budget spent, and the turn ended having said NOTHING - which is the
    # silence he reported in the first place.
    seen_calls: dict[str, dict] = {}
    #: Tools that have already errored this turn, so we stop feeding it a rake.
    failed_tools: list[str] = []

    async def execute(name: str, args: dict) -> dict:
        ui = voice.action_from(name, args)
        if ui is not None:
            ui_queue.append(ui)
            return {"ok": True, "note": "The page is doing that now."}
        # A tool that has already FAILED will fail the same way again. Three
        # identical ProgrammingErrors from query_data is how a turn spent its
        # whole lap budget and answered nothing — which he heard as "Sorry, I
        # got tangled up and lost my thread", over and over.
        if failed_tools.count(name) >= 2:
            return {
                "error": f"{name} has failed twice already.",
                "_note": (
                    "Stop using this tool. Answer him now with what you have, or "
                    "say plainly that you cannot look it up - do NOT try again."
                ),
            }
        signature = f"{name}:{json.dumps(args, sort_keys=True, default=str)[:400]}"
        if signature in seen_calls:
            prior = seen_calls[signature]
            return {
                **prior,
                "_note": (
                    "You have already run this exact lookup and this is the same "
                    "result. Do not call it again - answer him now with what you "
                    "have, even if it is only part of the picture."
                ),
            }
        fn = EXECUTORS.get(name)
        if fn is None:
            return {"error": f"unknown tool {name}"}
        try:
            out = await fn(db, user, args)
        except Exception:  # noqa: BLE001 - one bad tool must not end the answer
            log.exception("voice tool %s failed", name)
            out = {"error": f"The {name} lookup failed just then."}
        else:
            # A PROPOSAL, SPOKEN, IS AN INSTRUCTION. In the written chat it
            # becomes a card and somebody taps Confirm; out loud there is
            # nobody to tap, and he is holding a box of onions.
            out = await _voice_commit(db, user, name, out)
        if isinstance(out, dict) and out.get("error"):
            failed_tools.append(name)
        seen_calls[signature] = out if isinstance(out, dict) else {"result": out}
        return out

    async def events():
        meter: dict = {}
        spoken_buffer = ""
        seq = 0
        full = ""
        draft = ""
        #: Sentences already handed to Polly while the model is still writing.
        ahead: list = []
        speech_buffer = ""
        # One line per turn, so the questions he actually asks about the voice
        # are answerable from CloudWatch instead of by reproduction: how long
        # did it take, how much did it say, what did it do, did it loop.
        t0 = time.monotonic()
        tools_used: list[str] = []
        actions_sent = 0
        first_word_ms: int | None = None

        async def say(chunk: str) -> str | None:
            """Synthesise one chunk. Never lets a voice failure end the turn.

            RETURNS NOTHING FOR A TYPED TURN. Typing is not a request to be
            spoken to, and the saving is real: no Polly call, no base64 of an
            mp3 down the stream, and no second of latency, for audio that was
            going to be discarded — or worse, played at him unasked, which is
            what he reported.
            """
            if not payload.speak:
                return None
            try:
                audio = await run_in_threadpool(voice.speak, chunk, chosen_voice)
                return base64.b64encode(audio).decode("ascii")
            except Exception:  # noqa: BLE001
                log.exception("polly chunk failed")
                return None

        saving = asyncio.create_task(_save_question())
        try:
            async for ev in brain.generate_stream(
                system=system,
                history=[
                    *voice.history_for(payload.history),
                    {"role": "user", "content": voice.with_route(payload.text, payload.route)},
                ],
                tools=voice.tools_for_voice(user),
                execute=execute,
                model=model,
                meter=meter,
                live=True,
                # Roughly four short sentences. He is standing in a kitchen.
                max_tokens=voice.MAX_SPOKEN_TOKENS,
            ):
                # The page moves NOW, not after the sentence describing it.
                while ui_queue:
                    actions_sent += 1
                    yield _sse({"type": "action", "action": ui_queue.pop(0)})

                kind = ev.get("type")
                if kind == "tool":
                    tools_used.append(str(ev.get("name", "?")))
                    # The tool fires about a second in; the first word of the
                    # reply lands nearer three, because the model has to decide,
                    # run it, and only then start writing. Saying what it is
                    # doing turns a silent wait into a visible one.
                    yield _sse({"type": "doing", "label": voice.doing_label(ev.get("name", ""))})
                elif kind == "draft":
                    # On screen immediately, and SYNTHESISED SPECULATIVELY.
                    #
                    # "i can see text as soon as i complete... then after that
                    #  text fully came then only voice model is starting."
                    #
                    # Exactly what the code did: nothing reached Polly until
                    # `draft_end`, which only fires once the whole reply has
                    # been written. So the audio clock started where the text
                    # clock stopped, and he heard the sum of the two.
                    #
                    # Now each finished sentence goes to Polly the moment it
                    # exists, in the background, while the next one is still
                    # being written. Nothing is EMITTED until draft_end confirms
                    # this lap was the answer — so a thought is still never
                    # spoken aloud; we have merely done the waiting in advance.
                    # A dropped draft costs one wasted Polly call, which is
                    # about a hundredth of a penny against seconds of his time.
                    piece = ev.get("text", "")
                    if first_word_ms is None:
                        first_word_ms = int((time.monotonic() - t0) * 1000)
                    draft += piece
                    yield _sse({"type": "draft", "text": piece})

                    speech_buffer += piece
                    # Only speculate on text that looks like an ANSWER.
                    #
                    # A lap on its way to a tool call says something short —
                    # "Let me check the sales." — and that draft is then thrown
                    # away. Synthesising it costs a Polly call of 1.4 to 3
                    # seconds that competes with the real reply's, which is part
                    # of why an action turn made him wait so long to hear
                    # anything. Thoughts are short; answers are not.
                    if len(draft) >= 40:
                        while True:
                            chunk, speech_buffer = voice.next_sentence(speech_buffer)
                            if not chunk:
                                break
                            ahead.append(asyncio.create_task(say(chunk)))
                elif kind == "draft_end":
                    if ev.get("kept"):
                        full += draft
                        # Whatever is already in flight, plus the tail that
                        # never reached a full stop.
                        tail = speech_buffer.strip()
                        speech_buffer = ""
                        if tail:
                            ahead.append(asyncio.create_task(say(tail)))
                        for task in ahead:
                            b64 = await task
                            if b64:
                                yield _sse({"type": "audio", "b64": b64, "seq": seq})
                                seq += 1
                        ahead = []
                    else:
                        # A thought, not a reply. Throw the speculative audio
                        # away rather than letting it reach his speakers.
                        for task in ahead:
                            task.cancel()
                        ahead = []
                        speech_buffer = ""
                        yield _sse({"type": "draft_drop", "text": draft.strip()[:120]})
                    draft = ""
                elif kind == "delta":
                    piece = ev.get("text", "")
                    full += piece
                    spoken_buffer += piece
                    yield _sse({"type": "delta", "text": piece})
                elif kind == "done":
                    full = ev.get("text") or full
        except Exception as exc:  # noqa: BLE001 - he is standing there waiting
            log.exception("voice stream failed")
            yield _sse({"type": "error", "message": str(exc)[:200]})
            return

        while ui_queue:
            actions_sent += 1
            yield _sse({"type": "action", "action": ui_queue.pop(0)})

        tail, _ = voice.next_sentence(spoken_buffer, force=True)
        if tail:
            b64 = await say(tail)
            if b64:
                yield _sse({"type": "audio", "b64": b64, "seq": seq})

        try:
            await guard.record(
                db, user, kind="chat", model=meter.get("model", ""),
                input_tokens=meter.get("input_tokens", 0),
                output_tokens=meter.get("output_tokens", 0),
            )
        except Exception:  # noqa: BLE001 - metering must not break the answer
            log.exception("voice metering failed")

        # NEVER end a turn having said nothing. Observed on prod: the model
        # spent its whole lap budget on tool calls and produced no text, so the
        # panel just stopped - no words, no sound, no error. That is
        # indistinguishable from a hang, and it is exactly the complaint this
        # whole piece of work started from.
        if not full.strip():
            full = (
                "Sorry - I got tangled up looking that one up and lost my thread. "
                "Ask me again?"
            )
            yield _sse({"type": "delta", "text": full})
            b64 = await say(full)
            if b64:
                yield _sse({"type": "audio", "b64": b64, "seq": seq})

        spoken = voice.spoken_form(full)
        log.info(
            "voice turn: heard=%r words=%d spoken_words=%d trimmed=%s "
            "first_word=%sms total=%dms tools=%s actions=%d chunks=%d",
            payload.text[:80],
            len(full.split()),
            len(spoken.split()),
            len(spoken) < len(full),
            first_word_ms if first_word_ms is not None else "-",
            int((time.monotonic() - t0) * 1000),
            ",".join(tools_used) or "-",
            actions_sent,
            seq,
        )
        # The question's write has to land before the answer's, or the
        # conversation reads back out of order.
        try:
            await saving
        except Exception:  # noqa: BLE001
            log.exception("question write failed")
        try:
            await mem.remember(db, user, thread_id, "assistant", full)
        except Exception:  # noqa: BLE001 - a lost log line must not lose the reply
            log.exception("could not store the spoken turn")

        yield _sse({"type": "done", "text": full, "thread_id": str(thread_id)})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _polly_model(voice_id: str | None) -> str:
    """The pricing tier, carried in the model string so `estimate_cost` can see
    it. Polly's three engines differ by 7.5x — generative $30/M characters,
    neural $16/M, standard $4/M — so "polly" alone would misprice every row."""
    from app.assistant import voice as _v

    # VOICES already carries `engine` per voice, and the difference is 7.5x —
    # generative $30 per million characters against standard $4. Guessing one
    # constant here would misprice most rows in the one pool that exists to be
    # exactly attributable.
    row = next((v for v in _v.VOICES if v.get("id") == voice_id), None)
    engine = (row or {}).get("engine") or _v.FAST_ENGINE
    return f"polly-{str(engine).lower()}"


@router.post("/voice/speak")
async def voice_speak(
    payload: "SpeakIn",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Say it out loud. MP3 back, played by the bubble."""
    from app.assistant import voice

    started = time.monotonic()
    try:
        audio = await run_in_threadpool(voice.speak, payload.text, payload.voice)
    except Exception as exc:  # noqa: BLE001
        log.exception("polly failed")
        # RECORD THE FAILURE TOO. Polly bills on the request, and a voice that
        # keeps failing is a voice that keeps costing — invisible if only
        # successes are logged.
        await guard.record(
            db, user, kind="speech", model=_polly_model(payload.voice),
            input_tokens=len(payload.text or ""),
            latency_ms=int((time.monotonic() - started) * 1000), ok=False,
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The voice is not available right now."
        ) from exc

    # POLLY WAS BILLED AND UNATTRIBUTABLE.
    #
    # `cost_map.py` states that DIRECT means "Bedrock and Polly — we log every
    # call", and nothing in the voice path ever imported `guard`. So speech
    # appeared on the AWS bill ($0.39 over 90 days) with no way to say which
    # restaurant caused a penny of it — a directly attributable cost sitting in
    # the one pool that is supposed to be attributable by definition.
    #
    # Characters, not tokens: Polly prices per million CHARACTERS, which is why
    # `input_tokens` carries a character count for these rows and the price
    # table has `polly-*` entries whose output rate is zero. Audio is not
    # billed; the text that produced it is.
    await guard.record(
        db, user, kind="speech", model=_polly_model(payload.voice),
        input_tokens=len(payload.text or ""),
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    return Response(content=audio, media_type="audio/mpeg")


@router.post("/kiosk-quote")
async def kiosk_quote(
    payload: KioskQuoteIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> dict:
    """One encouraging line for the wall, changed daily.

    Readable by the KIOSK role, because the tablet is what asks for it.

    Deliberately cheap and deliberately optional. It is one short sentence
    once a day, the frontend already has a written set on screen before this
    is called, and any failure here is silent — a wall screen showing an error
    where a kind sentence should be is worse than one that never tried.
    """
    try:
        text = await service.short_line(
            db,
            user,
            "Write ONE short encouraging line for a restaurant kitchen's wall "
            "screen — the staff read it as they clock in. Under 15 words, warm, "
            "about craft, care, teamwork or not wasting food. No quotation "
            "marks, no attribution, no emoji. Just the sentence.",
        )
    except Exception:  # noqa: BLE001 — the written set is already on screen
        return {"text": ""}
    return {"text": (text or "").strip().strip('"')[:160]}


async def _voice_commit(db: AsyncSession, user: User, tool: str, out: dict) -> dict:
    """Carry a spoken proposal through to the write, and report it honestly.

        "i cant even able to add vendor ... do action, do edit, do delete,
         do save ... target is jarvis kinda AI we need"

    He said "add this vendor", then "please save", and was told the Save
    button was his to tap. That was the design and he has overruled it.

    NOT A NEW WRITE PATH. `actions.execute` is the same function the Confirm
    button calls: same permission check, same field validation, same undo
    handle. The voice reaches the existing door rather than getting its own.

    The return value is what the MODEL sees, so whatever it says next is
    grounded in what actually happened rather than in what it intended. A
    refusal comes back as a refusal, in words it can repeat out loud.
    """
    from app.assistant import actions as action_service
    from app.assistant import voice as voice_mod

    kind = voice_mod.executable_kind(tool)
    if kind is None or not isinstance(out, dict):
        return out
    proposal = out.get("proposal")
    if not isinstance(proposal, dict):
        # The tool declined to propose - a missing field, usually. Its own
        # message is better than anything invented here.
        return out
    fields = proposal.get("fields")
    if not isinstance(fields, dict):
        return out

    try:
        done = await action_service.execute(db, user, kind, fields)
    except Exception:  # noqa: BLE001 - a failed write must not end the turn
        log.exception("voice write %s failed", kind)
        return {
            **out,
            "saved": False,
            "_note": (
                f"Saving that {kind} FAILED. Tell him plainly it did not save "
                "and that he can try again. Do NOT say it is done."
            ),
        }

    if not done.get("ok"):
        return {
            **out,
            "saved": False,
            "error": done.get("error", "That could not be saved."),
            "_note": (
                "It was NOT saved - say why in one line, using the message "
                "above. Never claim it went in."
            ),
        }

    await db.commit()
    return {
        "saved": True,
        "summary": done.get("summary", ""),
        "undo": done.get("undo"),
        "_note": (
            "THIS IS SAVED - it is in the database now. Say so in the past "
            "tense, in one short line, and mention he can say 'undo' if it "
            "was wrong. Do not tell him to press anything."
        ),
    }
