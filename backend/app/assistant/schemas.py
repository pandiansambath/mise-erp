"""Request/response shapes for the Copilot chat endpoint."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    route: str | None = None  # the page the user is currently on, for context


class Action(BaseModel):
    label: str
    href: str


class ChatResponse(BaseModel):
    reply: str
    actions: list[Action] = Field(default_factory=list)
    used_tools: list[str] = Field(default_factory=list)
    configured: bool = True  # False ⇒ running the no-LLM fallback


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
