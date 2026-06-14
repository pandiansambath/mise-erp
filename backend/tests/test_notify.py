"""Notify tests — alerts no-op safely without a provider key configured."""
import pytest

from app.core import notify


@pytest.mark.asyncio
async def test_send_email_noop_without_key():
    # No RESEND_API_KEY in the test env → suppressed, returns False, never raises.
    assert await notify.send_email("owner@example.com", "Test", "Body") is False
