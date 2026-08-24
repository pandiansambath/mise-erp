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
