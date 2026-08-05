"""Narrating a turn while it happens.

The subtle part is WHICH text reaches the user. A tool-use loop cannot know
whether a lap ends in an answer or a tool call until the blocks arrive, so
every lap is streamed — and text from a lap that then calls a tool is the
model talking to ITSELF ("let me check the sales"). Forwarding it would type
private reasoning out as if it were the reply, confidently, in front of a
customer.

So these tests are mostly about restraint: what does NOT get sent.
"""
import pytest

from app.assistant import bedrock, brain


def _lap(text: str = "", calls: list[dict] | None = None, usage: dict | None = None):
    """One scripted exchange, in the shape `_one_lap` returns."""
    return (text, calls or [], usage or {})


def _script(laps: list, recorder: list | None = None):
    """Replace the Bedrock round-trip with a fixed sequence of laps."""
    seq = list(laps)

    async def fake(body, model, *, on_delta):
        text, calls, usage = seq.pop(0)
        if recorder is not None:
            recorder.append(body)
        # Real streaming delivers text in fragments; do the same so the test
        # exercises the buffering rather than a single tidy string.
        for piece in (text[i : i + 7] for i in range(0, len(text), 7)):
            if on_delta is not None:
                await on_delta(piece)
        return text, calls, usage

    return fake


async def _run(monkeypatch, laps, execute=None, recorder=None, **kw):
    monkeypatch.setattr(brain.streaming, "_one_lap", _script(laps, recorder))

    async def noop(name, args):
        return {"ok": True}

    out = []
    async for ev in brain.generate_stream(
        system="s",
        history=[{"role": "user", "content": "how are we doing?"}],
        tools=kw.pop("tools", []),
        execute=execute or noop,
        **kw,
    ):
        out.append(ev)
    return out


async def test_a_plain_answer_streams_word_by_word(monkeypatch) -> None:
    events = await _run(monkeypatch, [_lap("Food cost is 31% this week.")])

    deltas = [e for e in events if e["type"] == "delta"]
    assert len(deltas) > 1, "the answer arrived in one lump — nothing was streamed"
    assert "".join(d["text"] for d in deltas) == "Food cost is 31% this week."

    done = events[-1]
    assert done["type"] == "done"
    # The full text rides on `done` too, so a dropped delta costs nothing.
    assert done["text"] == "Food cost is 31% this week."


async def test_thinking_on_the_way_to_a_tool_is_never_typed_as_the_answer(
    monkeypatch,
) -> None:
    """THE test. This text is the model talking to itself."""
    events = await _run(
        monkeypatch,
        [
            _lap("Let me check this week's sales.", [{"id": "1", "name": "read_sales", "input": {}}]),
            _lap("You took £4,210."),
        ],
        tools=[{"name": "read_sales", "description": "d", "input_schema": {}}],
    )

    streamed = "".join(e["text"] for e in events if e["type"] == "delta")
    assert streamed == "You took £4,210."
    assert "Let me check" not in streamed

    # It is still SHOWN — as a thought, which is the whole point of the panel.
    thoughts = [e for e in events if e["type"] == "thought"]
    assert thoughts and thoughts[0]["text"] == "Let me check this week's sales."


async def test_each_tool_is_announced_before_it_runs(monkeypatch) -> None:
    """The order matters: "reading your sales" has to appear while the reading
    is happening, not after."""
    ran: list[str] = []

    async def execute(name, args):
        ran.append(name)
        return {"total": 4210}

    events = await _run(
        monkeypatch,
        [
            _lap("", [{"id": "1", "name": "read_sales", "input": {"days": 7}}]),
            _lap("Done."),
        ],
        execute=execute,
        tools=[{"name": "read_sales", "description": "d", "input_schema": {}}],
    )

    tools = [e for e in events if e["type"] == "tool"]
    assert [t["name"] for t in tools] == ["read_sales"]
    assert ran == ["read_sales"]
    # And the arguments are summarised for a human, not dumped as JSON.
    assert "days" in tools[0]["input"]


async def test_a_failing_tool_does_not_kill_the_turn(monkeypatch) -> None:
    """One bad tool must not cost the whole answer — the model can often still
    answer from what it has."""

    async def explode(name, args):
        raise RuntimeError("stock service is down")

    events = await _run(
        monkeypatch,
        [
            _lap("", [{"id": "1", "name": "low_stock", "input": {}}]),
            _lap("I could not read stock just now."),
        ],
        execute=explode,
        tools=[{"name": "low_stock", "description": "d", "input_schema": {}}],
    )

    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "I could not read stock just now."


async def test_the_last_lap_is_denied_tools_so_it_must_answer(monkeypatch) -> None:
    """Otherwise a model that keeps reaching for tools returns nothing at all
    after spending four billed round-trips."""
    bodies: list[dict] = []
    call = [{"id": "1", "name": "read_sales", "input": {}}]

    await _run(
        monkeypatch,
        [_lap("thinking", call) for _ in range(brain.MAX_LAPS - 1)] + [_lap("Final answer.")],
        recorder=bodies,
        tools=[{"name": "read_sales", "description": "d", "input_schema": {}}],
    )

    assert len(bodies) == brain.MAX_LAPS
    assert "tools" in bodies[0]
    assert "tools" not in bodies[-1], "the final lap could still call a tool"


async def test_token_usage_accumulates_across_laps(monkeypatch) -> None:
    """Tokens are money and a tool-use turn spends them several times. Metering
    only the last lap would under-bill every multi-step question."""
    meter: dict = {}
    await _run(
        monkeypatch,
        [
            _lap("", [{"id": "1", "name": "t", "input": {}}], {"input_tokens": 900, "output_tokens": 20}),
            _lap("Answer.", None, {"input_tokens": 1100, "output_tokens": 60}),
        ],
        meter=meter,
        tools=[{"name": "t", "description": "d", "input_schema": {}}],
    )

    assert meter["input_tokens"] == 2000
    assert meter["output_tokens"] == 80
    assert meter["model"]


async def test_every_tool_used_is_reported_on_done(monkeypatch) -> None:
    events = await _run(
        monkeypatch,
        [
            _lap("", [{"id": "1", "name": "read_sales", "input": {}}]),
            _lap("", [{"id": "2", "name": "low_stock", "input": {}}]),
            _lap("Both read."),
        ],
        tools=[{"name": "read_sales", "description": "d", "input_schema": {}}],
    )

    assert events[-1]["tools"] == ["read_sales", "low_stock"]


async def test_bedrock_being_down_raises_rather_than_answering_emptily(
    monkeypatch,
) -> None:
    """An empty reply looks like the model having nothing to say. The caller
    needs to know the difference so it can fall back."""

    async def dead(body, model, *, on_delta):
        raise bedrock.BedrockUnavailable("model access not enabled")

    monkeypatch.setattr(brain.streaming, "_one_lap", dead)

    with pytest.raises(brain.BrainError):
        async for _ in brain.generate_stream(
            system="s",
            history=[{"role": "user", "content": "hi"}],
            tools=[],
            execute=lambda n, a: None,
        ):
            pass


async def test_an_attachment_rides_on_the_newest_message(monkeypatch) -> None:
    """Shared with the buffered path via build_messages. A file that uploads
    and is then dropped leaves the model answering about nothing — which is a
    bug this codebase has already had once."""
    bodies: list[dict] = []
    await _run(
        monkeypatch,
        [_lap("I can see the receipt.")],
        recorder=bodies,
        attachment={"data": "aGVsbG8=", "mime": "text/plain", "name": "bill.txt"},
    )

    content = bodies[0]["messages"][-1]["content"]
    assert any("bill.txt" in str(block) for block in content)
