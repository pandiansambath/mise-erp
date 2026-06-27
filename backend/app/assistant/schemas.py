"""Request/response shapes for the Copilot chat endpoint."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class Attachment(BaseModel):
    mime: str
    data: str  # base64-encoded file bytes (image/PDF of a bill, receipt, etc.)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    route: str | None = None  # the page the user is currently on, for context
    attachment: Attachment | None = None  # a bill/receipt/photo to read
    user_name: str | None = None  # what the user asked to be called (set at onboarding)


class Action(BaseModel):
    label: str
    href: str


class ProposedAction(BaseModel):
    kind: str            # expense | sale | item | vendor
    label: str           # human label e.g. "expense"
    summary: str         # one-line "here's what I'll do"
    fields: dict = Field(default_factory=dict)  # normalised payload for /act


class ChatResponse(BaseModel):
    reply: str
    actions: list[Action] = Field(default_factory=list)
    pending_actions: list[ProposedAction] = Field(default_factory=list)
    used_tools: list[str] = Field(default_factory=list)
    configured: bool = True  # False ⇒ running the no-LLM fallback


class ActRequest(BaseModel):
    kind: str
    fields: dict = Field(default_factory=dict)


class ActResult(BaseModel):
    ok: bool
    summary: str = ""
    error: str = ""
    undo: dict | None = None  # {type, id} for a follow-up /undo


class UndoRequest(BaseModel):
    type: str
    id: str


# ── Document onboarding ────────────────────────────────────────────────────────
class IngestPreview(BaseModel):
    kind: str
    rows: list[dict] = Field(default_factory=list)  # proposed records (nothing written)


class IngestCommit(BaseModel):
    kind: str
    rows: list[dict] = Field(default_factory=list)


class IngestResult(BaseModel):
    kind: str
    created: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
