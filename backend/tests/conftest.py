"""Shared pytest fixtures.

Tests run against a DEDICATED Postgres database (``*_test``) derived from the
environment ``DATABASE_URL`` — we never touch the dev database. The test DB is
auto-created if missing, and every test starts from a clean schema.

Config env is set BEFORE importing the app so the cached Settings pick it up.
"""
import asyncio
import os
import re

# 1. Point the app at a dedicated test database (swap the db-name segment).
_base_url = os.environ.get("DATABASE_URL", "postgresql+asyncpg://mise:mise@db:5432/mise")
_test_url = re.sub(r"/[^/]+$", "/mise_test", _base_url)
os.environ["DATABASE_URL"] = _test_url
os.environ.setdefault("SECRET_KEY", "test-secret-key")
# Force (not setdefault): the dev container sets these, but tests need ci/NullPool
# semantics regardless of where they run.
os.environ["ENVIRONMENT"] = "ci"
os.environ["DEBUG"] = "false"


# 2. Ensure the test database exists (connect to the maintenance DB and CREATE).
async def _ensure_test_db() -> None:
    import asyncpg
    from sqlalchemy.engine import make_url

    url = make_url(_test_url)
    conn = await asyncpg.connect(
        host=url.host,
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        database="postgres",
    )
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", url.database)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{url.database}"')
    finally:
        await conn.close()


asyncio.run(_ensure_test_db())

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

import app.auth.models  # noqa: E402,F401  (register models on Base.metadata)
import app.hotels.models  # noqa: E402,F401
from app.auth.service import create_user  # noqa: E402
from app.core.database import AsyncSessionLocal, Base, engine  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.hotels.models import Hotel  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
async def _reset_db():
    """Drop & recreate all tables before each test for full isolation."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.fixture
async def db():
    async with AsyncSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def hotel(db) -> Hotel:
    """A default tenant for tests."""
    h = Hotel(name="Test Hotel", country="GB", base_currency="GBP", city="London")
    db.add(h)
    await db.commit()
    await db.refresh(h)
    return h


@pytest.fixture
def make_user(db, hotel):
    """Factory: create a persisted user in a hotel (defaults to the test hotel)."""

    async def _make(
        email: str,
        role: str,
        password: str = "password123",
        is_active: bool = True,
        hotel_id=None,
    ):
        user = await create_user(db, email, password, role, hotel_id or hotel.id)
        # fixture accounts mirror the migration's grandfathering (pre-email era)
        user.email_verified = True
        if not is_active:
            user.is_active = False
        await db.commit()
        await db.refresh(user)
        return user

    return _make


@pytest.fixture
def auth_header():
    """Build an Authorization header for a given user object."""

    def _header(user) -> dict[str, str]:
        token = create_access_token(subject=str(user.id), role=user.role)
        return {"Authorization": f"Bearer {token}"}

    return _header
