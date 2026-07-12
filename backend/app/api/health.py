"""Health & readiness endpoints (used by App Runner / load balancer probes)."""
import os

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.core.database import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Liveness probe — does NOT touch the database (must be cheap & always-up).
    `commit` = the git SHA this image was built from (deploy verification)."""
    return {"status": "ok", "version": __version__, "commit": os.getenv("APP_COMMIT", "unknown")}


@router.get("/health/db")
async def health_db(db: AsyncSession = Depends(get_db)) -> dict:
    """Readiness probe — verifies the database is reachable."""
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "reachable"}
