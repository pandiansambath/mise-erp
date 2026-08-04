"""What the assistant is allowed to look up on the open web.

The rule is: hospitality yes, medical and similar no. These tests exist because
the failure is not an exception — a guard that quietly stops working looks
exactly like a guard that works, right up until the app answers a medical
question with confidence.
"""
import pytest

from app.assistant import websearch


@pytest.mark.parametrize(
    "query",
    [
        "current wholesale price of basmati rice UK",
        "best paneer suppliers in Birmingham",
        "UK food hygiene rating scheme rules for takeaways",
        "what do other Indian restaurants charge for a dosa",
        "minimum wage for kitchen staff in the UK 2026",
        "allergen labelling rules for a takeaway menu",
    ],
)
def test_running_a_restaurant_is_in_scope(query: str) -> None:
    ok, reason = websearch.allowed(query)
    assert ok, f"should have allowed {query!r}: {reason}"


@pytest.mark.parametrize(
    "query",
    [
        "what are the symptoms of diabetes",
        "how do I treat an infection",
        "can I sue my landlord",
        "should I invest in bitcoin",
        "who should I vote for in the election",
    ],
)
def test_blocked_topics_are_refused(query: str) -> None:
    ok, reason = websearch.allowed(query)
    assert not ok, f"should have refused {query!r}"
    assert reason, "a refusal must explain itself, not just fail"


def test_food_words_cannot_smuggle_a_blocked_topic_through() -> None:
    """The reason the guard is deny-FIRST. An allow-list checked first would let
    'chef' or 'kitchen' carry a medical question straight past it."""
    for query in (
        "my chef has a rash, is it contagious",
        "restaurant staff member has covid symptoms, what medication",
        "kitchen porter injury compensation claim solicitor",
    ):
        ok, _ = websearch.allowed(query)
        assert not ok, f"food vocabulary must not unblock {query!r}"


def test_off_topic_questions_are_refused_even_when_harmless() -> None:
    """You asked for a restaurant assistant, not a general search engine. A
    harmless off-topic answer still trains people to use it as one."""
    for query in ("who won the football last night", "how tall is mount everest"):
        ok, reason = websearch.allowed(query)
        assert not ok
        assert "restaurant" in reason.lower() or "hospitality" in reason.lower()


def test_refusals_tell_you_how_to_rephrase() -> None:
    """A bare 'no' from a guard this conservative is a dead end. Some legitimate
    questions WILL be refused, so the message has to point a way forward."""
    _, reason = websearch.allowed("how tall is mount everest")
    assert "try" in reason.lower() or "ask" in reason.lower()


def test_empty_and_tiny_queries_do_not_reach_the_provider() -> None:
    for query in ("", "  ", "a"):
        ok, _ = websearch.allowed(query)
        assert not ok


@pytest.mark.asyncio
async def test_a_refused_search_never_calls_out(monkeypatch) -> None:
    """The guard must run BEFORE the network, or a blocked query still leaves
    the building — and still costs money."""
    called = False

    def _boom(*a, **k):
        nonlocal called
        called = True
        raise AssertionError("must not reach the provider")

    monkeypatch.setattr(websearch.settings, "web_search_api_key", "test-key", raising=False)
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", _boom)

    out = await websearch.search("what are the symptoms of diabetes")
    assert out.get("refused") is True
    assert called is False


@pytest.mark.asyncio
async def test_without_a_key_it_says_so_instead_of_pretending(monkeypatch) -> None:
    """An in-scope question with no provider configured must not look like a
    search that found nothing."""
    monkeypatch.setattr(websearch.settings, "web_search_api_key", "", raising=False)
    out = await websearch.search("wholesale price of basmati rice UK")
    assert out.get("unavailable") is True
    assert "own data" in out["message"]


@pytest.mark.asyncio
async def test_a_provider_outage_does_not_break_the_reply(monkeypatch) -> None:
    """A failed lookup should cost the user a sentence, not the whole answer."""
    monkeypatch.setattr(websearch.settings, "web_search_api_key", "test-key", raising=False)
    import httpx

    class _Dead:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): raise RuntimeError("network down")

    monkeypatch.setattr(httpx, "AsyncClient", _Dead)
    out = await websearch.search("paneer suppliers Birmingham")
    assert "error" in out
