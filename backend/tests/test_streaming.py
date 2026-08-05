"""Reassembling a streamed answer.

The owner's complaint was that fifteen silent seconds and a hang look
identical. Streaming fixes that — but it moves the model's reply from one JSON
document into dozens of fragments, and every fragment is a chance to lose
something quietly.

The parts worth guarding:

* **text arrives in pieces** and must come back out in order
* **tool arguments arrive as fragments of JSON** and are only valid once the
  block closes. Parsing them early gets you half a filter
* **truncated arguments must fail loudly**, not run with whatever survived
* **usage is spread across events** and has to be added up, because tokens are
  money and an under-count is a real cost that never gets billed

These drive the parser with a scripted event stream rather than Bedrock, so
they run anywhere and assert on the parsing rather than on the model.
"""
import json

import pytest

from app.assistant import bedrock, streaming


def _text_delta(text: str) -> dict:
    return {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}}


def _tool_start(name: str, tool_id: str = "t1") -> dict:
    return {
        "type": "content_block_start",
        "content_block": {"type": "tool_use", "id": tool_id, "name": name},
    }


def _json_delta(part: str) -> dict:
    return {
        "type": "content_block_delta",
        "delta": {"type": "input_json_delta", "partial_json": part},
    }


_STOP = {"type": "content_block_stop"}


def _script(events: list[dict]):
    """Stand in for Bedrock: replay a fixed event stream."""

    async def _gen(body, model=""):
        for ev in events:
            yield ev

    return _gen


async def _run(events: list[dict], monkeypatch, on_delta=None):
    monkeypatch.setattr(streaming, "_events", _script(events))
    return await streaming._one_lap({}, "", on_delta=on_delta)


async def test_text_fragments_come_back_in_order(monkeypatch) -> None:
    seen: list[str] = []

    async def collect(piece: str) -> None:
        seen.append(piece)

    text, tools, _ = await _run(
        [_text_delta("Your food cost "), _text_delta("is 31%"), _text_delta(" this week.")],
        monkeypatch,
        on_delta=collect,
    )

    assert text == "Your food cost is 31% this week."
    # And the caller saw every piece as it arrived — that IS the feature.
    assert seen == ["Your food cost ", "is 31%", " this week."]
    assert tools == []


async def test_tool_arguments_are_only_read_once_the_block_closes(monkeypatch) -> None:
    """They arrive as fragments of JSON. Parsing early gets half a filter —
    a query that runs against the wrong dates and looks like a real answer."""
    _, tools, _ = await _run(
        [
            _tool_start("read_sales"),
            _json_delta('{"date_from"'),
            _json_delta(': "2026-08-01",'),
            _json_delta(' "date_to": "2026-08-05"}'),
            _STOP,
        ],
        monkeypatch,
    )

    assert len(tools) == 1
    assert tools[0]["name"] == "read_sales"
    assert tools[0]["input"] == {"date_from": "2026-08-01", "date_to": "2026-08-05"}


async def test_a_truncated_argument_does_not_run_with_half_a_filter(monkeypatch) -> None:
    """An empty input makes the tool fail loudly. Guessing at what the rest of
    the JSON said would produce a confident answer to a question nobody asked."""
    _, tools, _ = await _run(
        [_tool_start("read_sales"), _json_delta('{"date_from": "2026-08'), _STOP],
        monkeypatch,
    )

    assert tools[0]["input"] == {}


async def test_a_tool_with_no_arguments_is_fine(monkeypatch) -> None:
    _, tools, _ = await _run([_tool_start("low_stock"), _STOP], monkeypatch)
    assert tools[0]["input"] == {}


async def test_several_tools_in_one_reply_are_kept_apart(monkeypatch) -> None:
    """Claude can ask for two things at once, and the fragments interleave in
    the stream only by block, not by tool."""
    _, tools, _ = await _run(
        [
            _tool_start("read_sales", "a"),
            _json_delta('{"days": 7}'),
            _STOP,
            _tool_start("low_stock", "b"),
            _json_delta('{"limit": 5}'),
            _STOP,
        ],
        monkeypatch,
    )

    assert [t["name"] for t in tools] == ["read_sales", "low_stock"]
    assert tools[0]["input"] == {"days": 7}
    assert tools[1]["input"] == {"limit": 5}
    assert tools[0]["id"] != tools[1]["id"]


async def test_thinking_text_and_a_tool_call_can_share_a_reply(monkeypatch) -> None:
    """"Let me check the sales" followed by the call. Both must survive — the
    text is what gets shown as the thought."""
    text, tools, _ = await _run(
        [
            _text_delta("Let me look at this week's takings."),
            _tool_start("read_sales"),
            _json_delta("{}"),
            _STOP,
        ],
        monkeypatch,
    )

    assert text == "Let me look at this week's takings."
    assert [t["name"] for t in tools] == ["read_sales"]


async def test_token_usage_is_added_up_across_events(monkeypatch) -> None:
    """Tokens are money. Usage is reported in more than one event and an
    under-count is a real cost that never gets billed to anybody."""
    _, _, usage = await _run(
        [
            {"type": "message_start", "message": {"usage": {"input_tokens": 900}}},
            _text_delta("ok"),
            {"type": "message_delta", "usage": {"output_tokens": 40}},
            {"type": "message_delta", "usage": {"output_tokens": 12}},
        ],
        monkeypatch,
    )

    assert usage["input_tokens"] == 900
    assert usage["output_tokens"] == 52


async def test_cache_tokens_are_recorded_under_the_names_the_meter_uses(
    monkeypatch,
) -> None:
    """Prompt caching is most of why this is affordable; if the read/write
    counts land under the wrong keys the saving is invisible."""
    _, _, usage = await _run(
        [
            {
                "type": "message_start",
                "message": {
                    "usage": {
                        "input_tokens": 10,
                        "cache_read_input_tokens": 4000,
                        "cache_creation_input_tokens": 120,
                    }
                },
            }
        ],
        monkeypatch,
    )

    assert usage["cache_read_tokens"] == 4000
    assert usage["cache_write_tokens"] == 120


async def test_a_stream_error_is_raised_not_swallowed(monkeypatch) -> None:
    """A broken stream that returns an empty answer looks exactly like the
    model having nothing to say."""
    with pytest.raises(bedrock.BedrockUnavailable):
        await _run(
            [_text_delta("partial"), {"type": "_error", "message": "throttled"}],
            monkeypatch,
        )


async def test_the_json_the_client_receives_is_parseable(monkeypatch) -> None:
    """Every event goes over the wire as one SSE `data:` line, so anything that
    cannot survive json.dumps breaks the whole stream, not one event."""
    _, tools, _ = await _run(
        [
            _tool_start("read_sales"),
            _json_delta('{"note": "café — 20% off"}'),
            _STOP,
        ],
        monkeypatch,
    )
    # Non-ASCII in a tool argument must round-trip; it reaches the UI as text.
    assert json.loads(json.dumps(tools[0]["input"])) == {"note": "café — 20% off"}
