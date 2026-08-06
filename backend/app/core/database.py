"""Async SQLAlchemy engine, session factory, and declarative Base."""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


# Echo prints EVERY SQL statement. `settings.debug` defaults to True and the
# production box never sets DEBUG, so production has been logging every query
# it runs — to stdout, and from there into CloudWatch. That is real work on
# every request (an AI turn runs a dozen queries through its tools), real
# ingestion cost, and it buries the lines worth reading. Echo belongs to a
# developer watching their own terminal, so it is tied to NOT being deployed.
_echo_sql = settings.debug and settings.environment not in ("production", "staging")
_engine_kwargs: dict = {"echo": _echo_sql, "future": True}
if settings.environment in ("ci", "test"):
    # Per-test event loops + a pooled asyncpg connection don't mix
    # (connections get bound to a closed loop). NullPool sidesteps it.
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_pre_ping"] = True

engine = create_async_engine(settings.database_url, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
