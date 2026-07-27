"""Claude-on-Bedrock brain: JSON hygiene + graceful degradation.

We never hit AWS in tests — the point is that the app behaves sanely when the
model isn't switched on, and that we parse what Claude actually returns.
"""
import pytest

from app.assistant import bedrock


def test_json_from_handles_fenced_and_bare():
    assert bedrock._json_from('{"a": 1}') == {"a": 1}
    assert bedrock._json_from('```json\n{"a": 2}\n```') == {"a": 2}
    # prose around the JSON still yields the object
    assert bedrock._json_from('Here you go:\n{"a": 3}\nhope that helps') == {"a": 3}


def test_json_from_rejects_garbage():
    with pytest.raises(bedrock.BedrockUnavailable):
        bedrock._json_from("no json at all")


def test_health_reports_not_configured_without_access(monkeypatch):
    def boom(_body):
        raise bedrock.BedrockUnavailable("model access not granted")

    monkeypatch.setattr(bedrock, "_invoke", boom)
    h = bedrock.health()
    assert h["configured"] is False
    assert "model" in h and "region" in h


def test_assistant_prompt_is_scoped_to_one_hotel(monkeypatch):
    """The guardrail lives in the system prompt — assert it actually says so."""
    seen = {}

    def fake(body, meter=None):  # meter: token counts for the spend guard
        seen.update(body)
        return "ok"

    monkeypatch.setattr(bedrock, "_invoke", fake)
    bedrock.ask("how were sales?", hotel_name="Milagu")
    system = seen["system"]
    assert "Milagu" in system
    # refuses off-topic, and never crosses tenants
    assert "outside my kitchen" in system
    assert "no knowledge of any other restaurant" in system
    assert "Never invent a number" in system
