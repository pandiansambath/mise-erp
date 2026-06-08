"""Server-Sent Events stream for live UI updates (e.g. PO/indent status).

EventSource can't send Authorization headers, so the JWT is passed as a query
param and validated here. Events are hotel-scoped via the in-process bus.
"""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import get_user_by_id
from app.core.database import get_db
from app.core.events import subscribe, unsubscribe
from app.core.security import decode_token

router = APIRouter(prefix="/events", tags=["events"])

_PING_SECONDS = 20  # keepalive so proxies don't drop idle connections


@router.get("/stream")
async def stream(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = await get_user_by_id(db, payload["sub"])
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    hotel_id = user.hotel_id
    queue = subscribe(hotel_id)

    async def gen():
        try:
            yield ": connected\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_PING_SECONDS)
                    yield f"data: {json.dumps(event)}\n\n"
                except TimeoutError:
                    yield ": ping\n\n"  # keepalive comment
        finally:
            unsubscribe(hotel_id, queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
