"""Copilot endpoint. Any authenticated user may ask; tools enforce their own
permission + hotel scope, so answers never leak across roles or tenants."""
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
        rows = await ingest.extract(data, mime, kind)
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
    media = (file.content_type or "image/jpeg").split(";")[0]
    if media not in (
        "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
    ):
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


class KioskQuoteIn(BaseModel):
    on: str = ""


class VoiceTurnIn(BaseModel):
    """One thing the owner said out loud."""

    text: str = Field(min_length=1, max_length=2000)
    history: list[dict] = Field(default_factory=list)
    #: Which page he is looking at, so "put it in here" means something.
    route: str | None = None
    #: Which of the six voices to answer in. The browser has always sent this
    #: and the schema did not declare it, so pydantic dropped it on the floor
    #: and `payload.voice` raised on every single streamed turn. Same family of
    #: fault as the response_model that strips undeclared fields - a field that
    #: quietly is not there, failing far from where it was omitted.
    voice: str = "Amy"


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
            return await fn(db, user, args)
        except Exception:  # noqa: BLE001 - one bad tool must not end the answer
            log.exception("voice tool %s failed", name)
            return {"error": f"The {name} lookup failed just then."}

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
                {"role": "user", "content": payload.text},
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
    model = await guard.model_for(db, user)
    chosen_voice = payload.voice or voice.DEFAULT_VOICE

    # `generate_stream` yields its `tool` event BEFORE running the tool, so the
    # result never rides on the event. The executor drops UI actions here and
    # the loop drains them on its next pass — which is the first moment the
    # action is knowable at all.
    ui_queue: list[dict] = []

    async def execute(name: str, args: dict) -> dict:
        ui = voice.action_from(name, args)
        if ui is not None:
            ui_queue.append(ui)
            return {"ok": True, "note": "The page is doing that now."}
        fn = EXECUTORS.get(name)
        if fn is None:
            return {"error": f"unknown tool {name}"}
        try:
            return await fn(db, user, args)
        except Exception:  # noqa: BLE001 - one bad tool must not end the answer
            log.exception("voice tool %s failed", name)
            return {"error": f"The {name} lookup failed just then."}

    async def events():
        meter: dict = {}
        spoken_buffer = ""
        seq = 0
        full = ""
        draft = ""

        async def say(chunk: str) -> str | None:
            """Synthesise one chunk. Never lets a voice failure end the turn."""
            try:
                audio = await run_in_threadpool(voice.speak, chunk, chosen_voice)
                return base64.b64encode(audio).decode("ascii")
            except Exception:  # noqa: BLE001
                log.exception("polly chunk failed")
                return None

        try:
            async for ev in brain.generate_stream(
                system=system,
                history=[
                    *voice.history_for(payload.history),
                    {"role": "user", "content": payload.text},
                ],
                tools=voice.tools_for_voice(user),
                execute=execute,
                model=model,
                meter=meter,
                live=True,
            ):
                # The page moves NOW, not after the sentence describing it.
                while ui_queue:
                    yield _sse({"type": "action", "action": ui_queue.pop(0)})

                kind = ev.get("type")
                if kind == "tool":
                    # The tool fires about a second in; the first word of the
                    # reply lands nearer three, because the model has to decide,
                    # run it, and only then start writing. Saying what it is
                    # doing turns a silent wait into a visible one.
                    yield _sse({"type": "doing", "label": voice.doing_label(ev.get("name", ""))})
                elif kind == "draft":
                    # On screen immediately. NOT spoken yet: this lap may turn
                    # out to have been the model thinking out loud on its way
                    # to a tool call, and "let me check the sales" said aloud
                    # as if it were the answer is worse than a short wait.
                    piece = ev.get("text", "")
                    draft += piece
                    yield _sse({"type": "draft", "text": piece})
                elif kind == "draft_end":
                    if ev.get("kept"):
                        # It WAS the answer. Now it may be spoken - and it goes
                        # sentence by sentence, so the first one is already
                        # coming out of Polly while the rest is synthesised.
                        full += draft
                        spoken_buffer += draft
                        while True:
                            chunk, spoken_buffer = voice.next_sentence(spoken_buffer)
                            if not chunk:
                                break
                            b64 = await say(chunk)
                            if b64:
                                yield _sse({"type": "audio", "b64": b64, "seq": seq})
                                seq += 1
                    else:
                        # A thought, not a reply. Tell the page to drop it.
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

        yield _sse({"type": "done", "text": full})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/voice/speak")
async def voice_speak(
    payload: "SpeakIn",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Say it out loud. MP3 back, played by the bubble."""
    from app.assistant import voice

    try:
        audio = await run_in_threadpool(voice.speak, payload.text, payload.voice)
    except Exception as exc:  # noqa: BLE001
        log.exception("polly failed")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The voice is not available right now."
        ) from exc
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
