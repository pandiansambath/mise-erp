"""Shared pytest fixtures.

Test config is set via env BEFORE importing the app so the cached Settings
pick it up. Unit tests use an in-memory SQLite DB so they need no Postgres.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("ENVIRONMENT", "ci")
os.environ.setdefault("DEBUG", "false")

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
async def client() -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
