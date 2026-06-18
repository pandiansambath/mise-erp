"""Copilot endpoint. Any authenticated user may ask; tools enforce their own
permission + hotel scope, so answers never leak across roles or tenants."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import provider, service
from app.assistant.schemas import ChatRequest, ChatResponse
from app.auth.deps import get_current_user
from app.auth.models import User
from app.core.database import get_db

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
    return await service.answer(db, user, req)
