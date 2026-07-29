"""The Control Room AI is the ONE assistant allowed across tenants.

Every other AI surface is confined to a single restaurant. These tests guard the
exception: that it can only ever be reached by a platform operator, and that
what it sees is platform metadata rather than a tenant's own books.
"""
import pytest

from app.platform_admin import ai as operator_brain


class _User:
    def __init__(self, platform: bool):
        self.is_platform_owner = platform
        self.hotel_id = None
        self.id = None


async def test_a_hotel_user_can_never_reach_it(db) -> None:
    """The router guards this too — but a cross-tenant assistant should not be
    protected by a single check."""
    with pytest.raises(PermissionError):
        await operator_brain.ask(db, _User(platform=False), "how are we doing?")


async def test_the_facts_carry_no_tenant_operational_data(db) -> None:
    """The operator needs to see that a hotel is struggling or overspending.
    They have no business reading its recipes, prices, sales or staff."""
    facts = await operator_brain._facts(db)

    assert "hotel_count" in facts
    assert "by_plan" in facts
    assert "by_subscription_status" in facts

    # nothing tenant-operational may leak in
    blob = str(facts).lower()
    for forbidden in ("recipe", "ingredient", "payroll", "salary", "customer", "price_per_unit"):
        assert forbidden not in blob, forbidden


async def test_system_prompt_still_forbids_inventing_and_leaking() -> None:
    prompt = operator_brain._SYSTEM.lower()
    assert "never invent a number" in prompt
    # It CAN now read tenant data — so the rule that matters shifts from "you
    # cannot see it" to "you do not repeat it".
    assert "never volunteer" in prompt


def test_the_operator_cannot_read_credentials_or_private_messages() -> None:
    """The operator runs the platform. That does not make them a party to
    hotel-to-hotel messages, and nothing justifies reading password hashes."""
    from app.assistant import query

    for forbidden in ("users", "chats", "chat_messages"):
        assert forbidden not in query.OPERATOR_READABLE, forbidden


def test_operator_scope_is_wider_than_a_hotel_scope() -> None:
    """The whole point: same machinery, no tenant filter."""
    from app.assistant import query

    assert "hotels" in query.OPERATOR_READABLE
    # a hotel's own assistant only ever sees the scoped views
    assert all(v.startswith("ai_") for v in query.READABLE)
