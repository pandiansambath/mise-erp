"""🎙️ The voice, tested where it can actually be wrong.

Two kinds of fault live in this module and neither shows up as an exception:

* **It says the wrong thing out loud.** `spoken_form` is the difference between
  "twelve hundred and forty pounds" and "asterisk asterisk pound one comma two
  four zero". Nothing crashes either way.
* **It is handed a tool it should not have.** `tools_for_voice` is the only
  thing standing between a spoken sentence and a write. If a rename ever slips
  a `propose_*` tool back into its kit, every other test in this repo still
  passes.

So the assertions here are about MEANING, not about the code running.
"""

import json
import uuid

import pytest

from app.assistant import voice
from app.auth.models import Role


class _FakeUser:
    """Enough of a User for the tool filter, which only reads role/permissions."""

    def __init__(self, role: str = "owner") -> None:
        self.id = uuid.uuid4()
        self.hotel_id = uuid.uuid4()
        self.role = role
        self.email = "owner@example.com"


# ── What it sounds like ─────────────────────────────────────────────────────


def test_money_is_said_not_spelled() -> None:
    # The one that matters most. Read literally, "£1,240" is "pound one comma
    # two four zero" - the characters, uselessly.
    assert voice.spoken_form("We took £1,240") == "We took 1240 pounds"
    assert voice.spoken_form("£12,450.50 net") == "12450.50 pounds net"
    assert voice.spoken_form("£99") == "99 pounds"


def test_markdown_is_for_eyes() -> None:
    assert voice.spoken_form("**Butter Chicken** is your best seller") == (
        "Butter Chicken is your best seller"
    )
    # A link's URL is noise; its words are the sentence.
    assert voice.spoken_form("see [Sales](/sales) for more") == "see Sales for more"


def test_a_table_becomes_a_sentence_not_a_stutter() -> None:
    said = voice.spoken_form("| Item | Left |\n|---|---|\n| Onion | 2kg |")
    assert "|" not in said
    assert "---" not in said
    assert "Onion" in said and "2kg" in said


def test_bullets_do_not_survive_into_speech() -> None:
    said = voice.spoken_form("### Low stock\n\n- Onion\n- Tomato\n* Garlic")
    assert said.count("-") == 0
    assert "#" not in said
    assert "Onion" in said and "Garlic" in said


def test_it_never_hands_polly_more_than_it_accepts() -> None:
    # Polly refuses oversized input outright, which would be a silent voice.
    assert len(voice.spoken_form("word " * 5000)) <= 2800


# ── What it is allowed to do ────────────────────────────────────────────────


def test_the_voice_holds_no_write_tools() -> None:
    """The rule the whole feature rests on, asserted rather than assumed."""
    names = {t["name"] for t in voice.tools_for_voice(_FakeUser())}
    assert not [n for n in names if n.startswith("propose_")], (
        f"a write tool reached the voice: {sorted(n for n in names if n.startswith('propose_'))}"
    )
    # There is no create_sale. Recording a sale means opening Sales and filling
    # the form, so the form's own permission check and confirm still apply.
    assert "create_sale" not in names


def test_go_to_is_the_only_way_to_move_the_page() -> None:
    # The assistant's own `navigate` tool returns a LINK. It would satisfy
    # "take me to sales" without the page moving an inch, which is the feature.
    names = {t["name"] for t in voice.tools_for_voice(_FakeUser())}
    assert "navigate" not in names
    assert "go_to" in names
    assert "fill_form" in names


def test_it_keeps_the_reads_that_make_it_useful() -> None:
    # A voice that cannot answer "what did we take today" is a novelty.
    names = {t["name"] for t in voice.tools_for_voice(_FakeUser())}
    for needed in ("business_overview", "sales_summary", "low_stock", "query_data"):
        assert needed in names, f"the voice lost {needed} and got dumber"


# ── What it asks the browser to do ──────────────────────────────────────────


def test_a_page_request_becomes_a_navigation() -> None:
    assert voice.action_from("go_to", {"page": "Sales"}) == {
        "kind": "navigate",
        "page": "sales",
    }


def test_a_fill_carries_its_own_summary_for_the_confirm() -> None:
    out = voice.action_from(
        "fill_form",
        {"fields": {"amount": 120, "method": "cash"}, "summary": "A £120 cash sale."},
    )
    assert out is not None
    assert out["kind"] == "fill"
    # Stringified, because the browser types these into inputs.
    assert out["fields"] == {"amount": "120", "method": "cash"}
    assert out["summary"] == "A £120 cash sale."


def test_a_nonsense_action_is_dropped_rather_than_half_done() -> None:
    assert voice.action_from("go_to", {"page": "   "}) is None
    assert voice.action_from("fill_form", {"fields": {}, "summary": "nothing"}) is None
    assert voice.action_from("fill_form", {"fields": "not a dict"}) is None
    assert voice.action_from("some_read_tool", {"q": "x"}) is None


# ── The voices themselves ───────────────────────────────────────────────────


def test_six_voices_three_of_each_as_asked() -> None:
    assert len(voice.VOICES) == 6
    assert sum(1 for v in voice.VOICES if v["sex"] == "male") == 3
    assert sum(1 for v in voice.VOICES if v["sex"] == "female") == 3
    # Every one needs a human label - "Kajal" tells an owner nothing on its own.
    assert all(v["who"] and v["label"] for v in voice.VOICES)
    assert voice.DEFAULT_VOICE in {v["id"] for v in voice.VOICES}


def test_every_voice_names_an_engine_polly_offers() -> None:
    assert all(v["engine"] in {"generative", "neural", "standard"} for v in voice.VOICES)


# ── The conversation it carries ─────────────────────────────────────────────


def test_history_is_trimmed_to_what_a_spoken_exchange_needs() -> None:
    turns = [{"role": "user", "content": f"turn {i}"} for i in range(30)]
    out = voice.history_for(turns)
    assert len(out) == 8
    assert out[-1]["content"] == "turn 29"


def test_history_survives_junk() -> None:
    out = voice.history_for(
        [
            {"role": "system", "content": "sneaky"},  # not a role the API takes
            {"role": "user", "content": ""},  # empty turns are dropped
            {"content": "no role at all"},
            {"role": "assistant", "content": "x" * 5000},
        ]
    )
    assert all(t["role"] in ("user", "assistant") for t in out)
    assert all(t["content"] for t in out)
    assert len(out[-1]["content"]) <= 1200


# ── The endpoints ───────────────────────────────────────────────────────────
#
# Bedrock and Polly are replaced, because what is being tested is the WIRING:
# does a UI tool call become an action for the browser instead of a database
# write, and does audio come back as audio rather than as JSON. Neither
# question needs a real model or a real synthesiser to answer.


@pytest.mark.asyncio
async def test_voice_needs_a_login(client):
    r = await client.post("/api/assistant/voice/turn", json={"text": "hello"})
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_voice_lists_its_six_voices(client, make_user, auth_header):
    user = await make_user("v1@x.com", Role.SUPER_ADMIN.value)
    r = await client.get("/api/assistant/voice/voices", headers=auth_header(user))
    assert r.status_code == 200
    body = r.json()
    assert len(body["voices"]) == 6
    assert body["default"] in {v["id"] for v in body["voices"]}


@pytest.mark.asyncio
async def test_a_spoken_page_request_comes_back_as_an_action(
    client, make_user, auth_header, monkeypatch
):
    """The feature in one test: the model asks for a page, the BROWSER gets
    told to move, and nothing is written on the way through."""
    from app.assistant import brain

    async def fake_generate(*, system, history, tools, execute, **kw):
        # The model decides to open Sales. `execute` is what turns that into an
        # instruction for the browser rather than a database call.
        await execute("go_to", {"page": "sales"})
        return "Right, Sales is up. Fill it in and I'll get out of your way.", []

    monkeypatch.setattr(brain, "generate", fake_generate)

    user = await make_user("v2@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/turn",
        json={"text": "take me to sales", "history": [], "route": "/dashboard"},
        headers=auth_header(user),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["actions"] == [{"kind": "navigate", "page": "sales"}]
    # And what it says must be sayable - no markdown reached the speaker.
    assert not set("*_#|") & set(body["spoken"])


@pytest.mark.asyncio
async def test_the_voice_answers_with_audio_not_json(
    client, make_user, auth_header, monkeypatch
):
    from app.assistant import voice as voice_mod

    monkeypatch.setattr(voice_mod, "speak", lambda text, v: b"ID3\x04fake-mp3-bytes")

    user = await make_user("v3@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/speak",
        json={"text": "We took twelve hundred today.", "voice": "Amy"},
        headers=auth_header(user),
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content.startswith(b"ID3")


@pytest.mark.asyncio
async def test_a_silent_polly_is_a_503_not_a_broken_download(
    client, make_user, auth_header, monkeypatch
):
    """A 200 holding an error page would reach the browser as a corrupt audio
    element and fail silently, which is the worst possible way for this to
    break: the owner just thinks it ignored them."""
    from app.assistant import voice as voice_mod

    def boom(text, v):
        raise RuntimeError("polly is having a day")

    monkeypatch.setattr(voice_mod, "speak", boom)

    user = await make_user("v4@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/speak",
        json={"text": "hello", "voice": "Amy"},
        headers=auth_header(user),
    )
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_a_cook_can_talk_to_it_not_just_the_owner(
    client, make_user, auth_header, monkeypatch
):
    """The gate that was wrong, kept honest.

    `require("ai:use")` looked right and was not: `ai:use` lives in ENVELOPES -
    what an owner MAY grant - not in PERMISSIONS, what a role HAS. So only the
    owner (who holds "*") got through, while the written chat was open to
    anyone signed in. The owner would have tested it, found it perfect, and
    every member of staff would have got a silent 403.
    """
    from app.assistant import brain

    async def fake_generate(*, system, history, tools, execute, **kw):
        return "Two hundred and forty quid so far. Steady.", []

    monkeypatch.setattr(brain, "generate", fake_generate)

    cook = await make_user("cook@x.com", Role.KITCHEN_MANAGER.value)
    r = await client.post(
        "/api/assistant/voice/turn",
        json={"text": "how are we doing today", "history": []},
        headers=auth_header(cook),
    )
    assert r.status_code == 200, f"a cook was locked out of the voice: {r.text[:200]}"


def test_the_ui_tools_carry_a_schema_the_brain_can_actually_read() -> None:
    """The bug this exists to prevent, which cost a whole deploy to find.

    brain._to_anthropic_tools() reads `t["parameters"]` and falls back to an EMPTY
    object schema. The UI tools were written with `input_schema`, the key
    Anthropic's own API uses - so they reached the model with no parameters at
    all. `go_to` had nowhere to put a page name.

    Nothing raised. The endpoint returned 200, the model replied warmly, and
    `actions` came back empty every single time: "take me to sales" was
    answered with a sentence and the page never moved. That is the whole
    feature, failing silently, behind a perfectly good HTTP status.
    """
    for tool in voice.UI_ACTIONS:
        schema = tool.get("parameters")
        assert schema, f"{tool['name']} has no `parameters` - brain would send an empty schema"
        assert schema.get("properties"), f"{tool['name']} declares no properties"
        assert schema.get("required"), f"{tool['name']} makes every argument optional"


def test_every_tool_the_voice_offers_survives_the_brains_translation() -> None:
    """Belt and braces: run the real translation and check nothing comes out
    hollow. A read tool renamed upstream would fail here too."""
    from app.assistant import brain

    translated = brain._to_anthropic_tools(voice.tools_for_voice(_FakeUser()))
    for t in translated:
        assert t["input_schema"].get("properties") is not None, f"{t['name']} lost its schema"
    names = {t["name"] for t in translated}
    assert {"go_to", "fill_form"} <= names


# ── Speaking early, without speaking a thought ──────────────────────────────


def test_a_sentence_is_split_off_as_soon_as_there_is_one():
    from app.assistant.voice import next_sentence

    chunk, rest = next_sentence("We took twelve hundred pounds today. It is up on yesterday.")
    assert chunk == "We took twelve hundred pounds today."
    assert rest.strip() == "It is up on yesterday."


def test_a_decimal_is_not_the_end_of_a_sentence():
    """"1.5 kg" would otherwise be shipped to Polly as "1." then " 5 kg"."""
    from app.assistant.voice import next_sentence

    chunk, _ = next_sentence("The onion is at 1.5 kg against a minimum of ten kilos. Order it.")
    assert chunk == "The onion is at 1.5 kg against a minimum of ten kilos."


def test_a_short_fragment_waits_for_more():
    """A per-request round trip costs more than "Yes." saves, and it comes out chopped."""
    from app.assistant.voice import next_sentence

    chunk, rest = next_sentence("Yes. ")
    assert chunk == ""
    assert rest == "Yes. "


def test_the_last_thing_said_is_never_left_unspoken():
    from app.assistant.voice import next_sentence

    chunk, rest = next_sentence("no full stop on this one", force=True)
    assert chunk == "no full stop on this one"
    assert rest == ""


def test_a_thought_is_drafted_but_never_kept(monkeypatch):
    """The whole reason drafts and deltas are different events.

    Lap one is the model thinking out loud on its way to a tool call. Lap two
    is the answer. Only the second may reach Polly - reading "let me check the
    sales" aloud as if it were the reply is worse than a short wait.
    """
    import asyncio

    from app.assistant import brain

    laps = [
        ("Let me check the sales.", [{"type": "tool_use", "id": "t1", "name": "sales", "input": {}}]),
        ("We took twelve hundred pounds.", []),
    ]

    async def fake_lap(body, model, on_delta=None):
        text, calls = laps.pop(0)
        for word in text.split(" "):
            if on_delta:
                await on_delta(word + " ")
        return text, calls, {"input_tokens": 1, "output_tokens": 1}

    monkeypatch.setattr(brain.streaming, "_one_lap", fake_lap)

    async def execute(name, args):
        return {"ok": True}

    async def run():
        return [
            ev
            async for ev in brain.generate_stream(
                system="s", history=[{"role": "user", "content": "hi"}],
                tools=[], execute=execute, live=True,
            )
        ]

    events = asyncio.run(run())
    ends = [e for e in events if e["type"] == "draft_end"]
    assert [e["kept"] for e in ends] == [False, True], events
    drafted = "".join(e["text"] for e in events if e["type"] == "draft")
    assert "Let me check" in drafted, "the thought should still reach the SCREEN"
    # And in live mode nothing is sent twice.
    assert not [e for e in events if e["type"] == "delta"], "live mode double-sent the reply"


# ── The streaming turn, end to end ──────────────────────────────────────────


def _frames(body: str) -> list[dict]:
    """The SSE frames of a response, as the browser would parse them."""
    out = []
    for frame in body.split("\n\n"):
        line = next((line for line in frame.split("\n") if line.startswith("data:")), None)
        if line:
            out.append(json.loads(line[5:].strip()))
    return out


@pytest.mark.asyncio
async def test_the_stream_sends_text_then_audio(client, make_user, auth_header, monkeypatch):
    """One request now carries what two used to, in the order each becomes true.

    It was /voice/turn and then /voice/speak, in series, with nothing beginning
    until everything had finished - about eight seconds before a sound.
    """
    from app.assistant import brain, voice

    async def fake_stream(**kw):
        for piece in ("We took ", "twelve hundred pounds today. ", "Steady enough."):
            yield {"type": "draft", "text": piece}
        yield {"type": "draft_end", "kept": True}
        yield {"type": "done", "text": "We took twelve hundred pounds today. Steady enough."}

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    monkeypatch.setattr(voice, "speak", lambda text, v=None, engine=None: b"ID3fake-mp3")

    owner = await make_user("owner-stream@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/stream",
        json={"text": "what did we take today", "history": []},
        headers=auth_header(owner),
    )
    assert r.status_code == 200
    evs = _frames(r.text)
    kinds = [e["type"] for e in evs]

    assert "draft" in kinds, "no text was streamed"
    assert "audio" in kinds, "nothing was ever spoken"
    # Text must not wait for the audio - that ordering IS the feature.
    assert kinds.index("draft") < kinds.index("audio")
    assert kinds[-1] == "done"
    said = "".join(e["text"] for e in evs if e["type"] == "draft")
    assert "twelve hundred pounds" in said


@pytest.mark.asyncio
async def test_a_thought_is_shown_but_never_spoken(client, make_user, auth_header, monkeypatch):
    """The safety property of the whole streaming design.

    Lap one is the model thinking out loud on its way to a tool call. Reading
    "let me check the sales" aloud as if it were the answer is worse than a
    short wait, so a dropped draft must produce NO audio at all.
    """
    from app.assistant import brain, voice

    async def fake_stream(**kw):
        yield {"type": "draft", "text": "Let me check the sales."}
        yield {"type": "draft_end", "kept": False}
        yield {"type": "done", "text": ""}

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    spoken: list[str] = []

    def spy(text, v=None, engine=None):
        spoken.append(text)
        return b"ID3fake-mp3"

    monkeypatch.setattr(voice, "speak", spy)

    owner = await make_user("owner-thought@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/stream",
        json={"text": "how are sales", "history": []},
        headers=auth_header(owner),
    )
    kinds = [e["type"] for e in _frames(r.text)]
    assert "draft_drop" in kinds, "the page was never told to drop the thought"
    # The property is about WHAT was spoken, not whether anything was.
    #
    # This originally asserted no audio at all, and then a second guard landed —
    # a turn may no longer end in silence — so the fallback line ("I got tangled
    # up...") is now spoken here, correctly. Asserting "nothing was said" made
    # the two guards look like they contradicted each other when they do not:
    # the thought must never be read aloud AS the answer, and a dead turn must
    # still say something. Both hold.
    assert not any("check the sales" in t.lower() for t in spoken), (
        f"the model's private thought was read aloud: {spoken}"
    )


@pytest.mark.asyncio
async def test_the_page_is_told_to_move_before_the_sentence_about_it(
    client, make_user, auth_header, monkeypatch
):
    """"take me to sales" has to MOVE the page, not describe moving it."""
    from app.assistant import brain, voice

    async def fake_stream(*, execute, **kw):
        await execute("go_to", {"page": "sales"})
        yield {"type": "draft", "text": "Sales is open for you now."}
        yield {"type": "draft_end", "kept": True}
        yield {"type": "done", "text": "Sales is open for you now."}

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    monkeypatch.setattr(voice, "speak", lambda text, v=None, engine=None: b"ID3fake-mp3")

    owner = await make_user("owner-nav@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/stream",
        json={"text": "take me to sales", "history": []},
        headers=auth_header(owner),
    )
    evs = _frames(r.text)
    actions = [e["action"] for e in evs if e["type"] == "action"]
    assert actions == [{"kind": "navigate", "page": "sales"}], evs
    kinds = [e["type"] for e in evs]
    assert kinds.index("action") < kinds.index("draft"), "the page moved after the sentence"


@pytest.mark.asyncio
async def test_a_mute_polly_still_answers_in_text(client, make_user, auth_header, monkeypatch):
    """Losing the voice must not lose the reply. He can still read it."""
    from app.assistant import brain, voice

    async def fake_stream(**kw):
        yield {"type": "draft", "text": "Onions are the urgent one."}
        yield {"type": "draft_end", "kept": True}
        yield {"type": "done", "text": "Onions are the urgent one."}

    def boom(text, v=None, engine=None):
        raise RuntimeError("Polly is down")

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    monkeypatch.setattr(voice, "speak", boom)

    owner = await make_user("owner-mute@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/stream",
        json={"text": "what is low", "history": []},
        headers=auth_header(owner),
    )
    assert r.status_code == 200
    evs = _frames(r.text)
    kinds = [e["type"] for e in evs]
    assert "audio" not in kinds
    assert kinds[-1] == "done", "a dead Polly killed the whole turn"
    assert "Onions" in "".join(e["text"] for e in evs if e["type"] == "draft")


@pytest.mark.asyncio
async def test_a_dead_brain_ends_the_stream_politely(
    client, make_user, auth_header, monkeypatch
):
    """Bedrock falling over mid-sentence must not hang the panel.

    The browser is holding an open connection and a person is watching a
    listening ring. A stream that simply stops looks exactly like a stream that
    is still thinking, which is the two-minute silence all over again.
    """
    from app.assistant import brain

    async def fake_stream(**kw):
        yield {"type": "draft", "text": "Let me look."}
        raise RuntimeError("bedrock threw")

    monkeypatch.setattr(brain, "generate_stream", fake_stream)

    owner = await make_user("owner-dead@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/stream",
        json={"text": "what is low", "history": []},
        headers=auth_header(owner),
    )
    assert r.status_code == 200, "the failure must arrive IN the stream, not as a dead socket"
    evs = _frames(r.text)
    assert evs[-1]["type"] == "error", evs
    assert evs[-1]["message"]


@pytest.mark.asyncio
async def test_a_cook_can_use_the_stream_too(client, make_user, auth_header, monkeypatch):
    """The same gate that was wrong on /voice/turn, checked on its replacement.

    `require("ai:use")` looked right and was not - `ai:use` lives in ENVELOPES,
    what an owner MAY grant, not in PERMISSIONS, what a role HAS. The owner
    would have tested it, found it perfect, and every member of staff would
    have got a silent 403. A new endpoint is a new chance to make that mistake.
    """
    from app.assistant import brain, voice

    async def fake_stream(**kw):
        yield {"type": "draft", "text": "Four things are low."}
        yield {"type": "draft_end", "kept": True}
        yield {"type": "done", "text": "Four things are low."}

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    monkeypatch.setattr(voice, "speak", lambda text, v=None, engine=None: b"ID3fake-mp3")

    cook = await make_user("cook-stream@x.com", Role.KITCHEN_MANAGER.value)
    r = await client.post(
        "/api/assistant/voice/stream",
        json={"text": "what is low", "history": []},
        headers=auth_header(cook),
    )
    assert r.status_code == 200, "a cook was locked out of the voice"
    assert "Four things are low." in "".join(
        e["text"] for e in _frames(r.text) if e["type"] == "draft"
    )


@pytest.mark.asyncio
async def test_it_says_what_it_is_doing_before_it_can_answer(
    client, make_user, auth_header, monkeypatch
):
    """Filling the three seconds before the first word.

    Measured on the live box: the tool fires around a second in, the first word
    of the reply nearer three. He had already called three seconds too slow, so
    the wait has to be visible rather than silent - and in words a person uses,
    not the tool's own name.
    """
    from app.assistant import brain, voice

    async def fake_stream(**kw):
        yield {"type": "tool", "name": "sales_today", "input": {}}
        yield {"type": "draft", "text": "Nothing yet today."}
        yield {"type": "draft_end", "kept": True}
        yield {"type": "done", "text": "Nothing yet today."}

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    monkeypatch.setattr(voice, "speak", lambda text, v=None, engine=None: b"ID3fake-mp3")

    owner = await make_user("owner-doing@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/stream",
        json={"text": "what did we take", "history": []},
        headers=auth_header(owner),
    )
    evs = _frames(r.text)
    kinds = [e["type"] for e in evs]
    assert "doing" in kinds, "nothing was shown while it looked things up"
    assert kinds.index("doing") < kinds.index("draft")
    label = next(e["label"] for e in evs if e["type"] == "doing")
    assert "sales_today" not in label, f"the tool's own name leaked to the screen: {label}"
    assert label == "Checking today's takings…"


def test_an_unknown_tool_still_gets_a_readable_label():
    """A new tool must not put a snake_case identifier on his screen."""
    from app.assistant.voice import doing_label

    assert doing_label("some_new_lookup") == "Checking some new lookup…"
    assert doing_label("") == "Working on it…"


def test_the_page_he_is_on_rides_with_the_question_not_the_system_prompt():
    """Bedrock's prompt cache only hits on a byte-identical system block.

    That block carries the whole knowledge brief - the expensive part - so
    putting the current page in it meant every navigation wrote a fresh cache
    entry instead of reading a warm one, and the biggest prompt we send was
    re-processed from scratch all day.
    """
    from app.assistant.voice import with_route

    assert with_route("add 120 cash", "/sales").startswith("[He is on the /sales page")
    assert "add 120 cash" in with_route("add 120 cash", "/sales")
    # No page, no noise.
    assert with_route("hello", None) == "hello"


@pytest.mark.asyncio
async def test_the_system_prompt_is_the_same_bytes_on_every_page(
    client, make_user, auth_header, monkeypatch
):
    """The property the cache actually depends on, asserted directly."""
    from app.assistant import brain, voice

    seen: list[str] = []

    async def fake_stream(*, system, **kw):
        seen.append(system)
        yield {"type": "draft", "text": "Fine."}
        yield {"type": "draft_end", "kept": True}
        yield {"type": "done", "text": "Fine."}

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    monkeypatch.setattr(voice, "speak", lambda text, v=None, engine=None: b"ID3fake-mp3")

    owner = await make_user("owner-cache@x.com", Role.SUPER_ADMIN.value)
    for route in ("/dashboard", "/sales", "/expenses"):
        await client.post(
            "/api/assistant/voice/stream",
            json={"text": "how are we doing", "history": [], "route": route},
            headers=auth_header(owner),
        )
    assert len(set(seen)) == 1, "the system prompt changes per page, so the cache never hits"


@pytest.mark.asyncio
async def test_a_turn_never_ends_having_said_nothing(
    client, make_user, auth_header, monkeypatch
):
    """Observed on prod, and it is the original complaint in a new costume.

    The model spent its whole lap budget on tool calls and produced no text, so
    the stream simply stopped: no words, no sound, no error. That is
    indistinguishable from a hang — which is exactly what "I tapped and waited
    two minutes" felt like.
    """
    from app.assistant import brain, voice

    async def fake_stream(**kw):
        # Three laps of looking things up and never answering.
        for _ in range(3):
            yield {"type": "draft_end", "kept": False}
            yield {"type": "tool", "name": "query_data", "input": {}}
        yield {"type": "done", "text": ""}

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    monkeypatch.setattr(voice, "speak", lambda text, v=None, engine=None: b"ID3fake-mp3")

    owner = await make_user("owner-silent@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/voice/stream",
        json={"text": "what did we take today", "history": []},
        headers=auth_header(owner),
    )
    evs = _frames(r.text)
    said = "".join(e.get("text", "") for e in evs if e["type"] in ("draft", "delta"))
    assert said.strip(), "the turn ended in total silence"
    assert any(e["type"] == "audio" for e in evs), "it went quiet as well as blank"
    assert evs[-1]["type"] == "done"
    assert evs[-1]["text"].strip()


@pytest.mark.asyncio
async def test_the_same_lookup_twice_is_told_to_stop(
    client, make_user, auth_header, monkeypatch
):
    """Asking the same question twice does not make the answer arrive.

    Prod called query_data three times with identical arguments and burned the
    whole lap budget doing it. The second identical call now comes back with
    the same data AND an instruction to answer from what it already has.
    """
    from app.assistant import brain, voice

    results: list[dict] = []

    async def fake_stream(*, execute, **kw):
        results.append(await execute("query_data", {"sql": "select 1"}))
        results.append(await execute("query_data", {"sql": "select 1"}))
        yield {"type": "draft", "text": "Twelve hundred."}
        yield {"type": "draft_end", "kept": True}
        yield {"type": "done", "text": "Twelve hundred."}

    monkeypatch.setattr(brain, "generate_stream", fake_stream)
    monkeypatch.setattr(voice, "speak", lambda text, v=None, engine=None: b"ID3fake-mp3")

    owner = await make_user("owner-loop@x.com", Role.SUPER_ADMIN.value)
    await client.post(
        "/api/assistant/voice/stream",
        json={"text": "what did we take", "history": []},
        headers=auth_header(owner),
    )
    assert len(results) == 2
    assert "_note" not in results[0], "the FIRST call must be clean"
    assert "_note" in results[1], "a repeated identical lookup was not challenged"
    assert "answer him now" in results[1]["_note"]


def test_the_signed_listen_url_is_shaped_the_way_transcribe_wants(monkeypatch):
    """Brave's refusal is not something we can argue with, so we grew our own ears.

    The browser opens this socket ITSELF — no audio passes through our box —
    so the URL has to be right without anything downstream to correct it.
    """
    import sys
    import types

    fake = types.ModuleType("boto3")

    class Creds:
        access_key = "AKIAEXAMPLE"
        secret_key = "shhh"
        token = "sess-token"

        def get_frozen_credentials(self):
            return self

    fake.Session = lambda: types.SimpleNamespace(get_credentials=lambda: Creds())
    monkeypatch.setitem(sys.modules, "boto3", fake)

    from importlib import reload

    from app.assistant import listen as listen_mod

    reload(listen_mod)
    import urllib.parse as up

    url = listen_mod.presigned_url()
    parsed = up.urlparse(url)
    q = up.parse_qs(parsed.query)

    assert parsed.scheme == "wss"
    assert parsed.netloc == "transcribestreaming.eu-west-2.amazonaws.com:8443"
    assert parsed.path == "/stream-transcription-websocket"
    assert q["media-encoding"] == ["pcm"]
    assert q["sample-rate"] == ["16000"]
    assert len(q["X-Amz-Signature"][0]) == 64
    # A temporary credential's session token must be SIGNED, not merely
    # attached — an unsigned token is rejected at the handshake.
    assert "X-Amz-Security-Token" in q
    first = q["X-Amz-Signature"][0]
    Creds.token = "a-different-token"
    second = up.parse_qs(up.urlparse(listen_mod.presigned_url()).query)["X-Amz-Signature"][0]
    assert first != second, "the session token is not part of the signature"


def test_it_opens_its_own_mouth():
    """"once user click the voice model that model need to start the conversation."""
    from app.assistant.voice import GREETINGS, greeting

    assert len(GREETINGS) >= 3, "one fixed hello becomes wallpaper by Tuesday"
    # The property that matters is not punctuation - "Ask me about the money,
    # the stock or the rota" invites plenty without a question mark. It is that
    # every opener says what he can ASK FOR. The hardest thing about talking to
    # a machine is not knowing what it is for, and "Hello!" does not help.
    offers = ("ask", "tell me", "shall i", "what do you need", "want")
    for line in GREETINGS:
        assert any(w in line.lower() for w in offers), f"this opener offers nothing: {line}"
    assert greeting(0) != greeting(1), "it does not rotate"
