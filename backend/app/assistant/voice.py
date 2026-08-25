"""🎙️ THE VOICE — hearing, thinking, speaking, and doing.

    "voice to voice, voice to action... literally I can do anything with the
     owner's permission... it needs to be friendly, with humour, very very
     friendly voice tone."
    "for now we can use bedrock... anyway action done by claude."

He is right, and that last line decided the architecture. The obvious answer on
an AWS stack is Amazon Nova Sonic — true speech-to-speech, one model, one hop.
Two things rule it out for now:

  * Its Python support is an EXPERIMENTAL awslabs SDK rather than boto3, and a
    production dependency that ships with "experimental" on the tin is a poor
    bet for the feature an owner talks to all day.
  * It is not in eu-west-2. A London restaurant's takings, read aloud, would
    cross to us-east-1 to be understood.

So the pipeline is: **the browser hears, Claude thinks, Polly speaks.** Claude
already holds every tool, every permission check and every bit of tuning we have
done — nothing about the voice gets to skip any of it.

THE RULE THIS FILE EXISTS TO ENFORCE
------------------------------------
The voice NEVER decides whether an action is allowed. It proposes an action and
the browser performs it through the ordinary UI, against the ordinary API, with
the ordinary confirmation. A spoken instruction is a request, exactly like a
click; it is not a password.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import BaseModel, Field

from app.auth.models import User

log = logging.getLogger("mise.voice")

#: Six voices, three of each, as he asked. Polly's names mean nothing to an
#: owner, so each carries the word a person would actually use to pick one.
#:
#: ENGINE. "generative" is Polly's conversational engine and it is a different
#: thing to listen to - it breathes, it lands a joke, it does not read. He asked
#: for "friendly, with humour, very very friendly", so where a voice has it, it
#: gets it. Only four English voices do; the other two fall back to neural,
#: which is why the engine is per-voice rather than a constant. It costs about
#: twice as much per character and a spoken reply is two sentences, so the
#: difference is fractions of a penny a turn.
VOICES: list[dict[str, str]] = [
    {"id": "Amy", "label": "Amy", "who": "British, warm",
     "sex": "female", "engine": "generative"},
    {"id": "Joanna", "label": "Joanna", "who": "American, bright",
     "sex": "female", "engine": "generative"},
    {"id": "Kajal", "label": "Kajal", "who": "Indian English, easy",
     "sex": "female", "engine": "neural"},
    {"id": "Brian", "label": "Brian", "who": "British, dry",
     "sex": "male", "engine": "generative"},
    {"id": "Stephen", "label": "Stephen", "who": "American, upbeat",
     "sex": "male", "engine": "generative"},
    {"id": "Arthur", "label": "Arthur", "who": "British, calm",
     "sex": "male", "engine": "neural"},
]
DEFAULT_VOICE = "Amy"


def _polly():
    # Imported here, not at module scope. Everything else in this file is a
    # pure function, and making the module unimportable without boto3 puts a
    # network library between the tests and the rules they check.
    import boto3

    return boto3.client("polly", region_name="eu-west-2")


#: Measured on the live box, same sentence: generative 2.39s, neural 0.93s.
#: "voice response is very very late" — so the default is the fast one. The
#: generative engine sounds better and a kitchen with a person waiting in it
#: does not care; a second and a half of silence is the thing he noticed.
FAST_ENGINE = "neural"


def speak(text: str, voice: str = DEFAULT_VOICE, engine: str = FAST_ENGINE) -> bytes:
    """Turn a reply into MP3.

    Polly is told to read it as speech, not as a document: the assistant's
    written answers are full of markdown and £ signs, and "asterisk asterisk
    Butter Chicken" is not a friendly tone of voice.
    """
    chosen = next((v for v in VOICES if v["id"] == voice), None) or VOICES[0]
    clean = spoken_form(text)
    # Ask for the requested engine, then the voice's own, then neural - without
    # repeating one. Any voice can lose an engine in a region at any time, and
    # "the assistant went mute" is a worse outcome than "it sounded slightly
    # flatter for one sentence".
    order: list[str] = []
    for e in (engine, chosen["engine"], "neural"):
        if e and e not in order:
            order.append(e)
    for eng in order:
        try:
            out = _polly().synthesize_speech(
                Text=clean,
                OutputFormat="mp3",
                VoiceId=chosen["id"],
                Engine=eng,
            )
            return out["AudioStream"].read()
        except Exception:  # noqa: BLE001 - botocore's errors, without the import
            log.warning("polly %s/%s failed", chosen["id"], eng, exc_info=True)
    raise RuntimeError(f"Polly would not speak as {chosen['id']}")


def spoken_form(text: str) -> str:
    """Strip what belongs on a page but not in a sentence.

    Markdown, emoji and table pipes are all invisible when read and ridiculous
    when spoken. £ is the one that matters most: "£1,240" said literally is
    "pound one comma two four zero", so it becomes "1240 pounds" and Polly's
    own number handling does the rest.
    """
    import re

    t = text
    t = re.sub(r"^[ \t|:-]*-{3,}[ \t|:-]*$", " ", t, flags=re.M)  # table rules
    t = t.replace("|", " ")
    t = re.sub(r"[*_`#>]+", "", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)  # links -> their words
    # Commas first, then the sign. A thousand separator left in is read out
    # as "one comma two four zero" - the characters, uselessly.
    t = re.sub(r"(\d),(?=\d{3}\b)", r"\1", t)
    t = re.sub(r"£\s?(\d+(?:\.\d+)?)", r"\1 pounds", t)
    # Bullets are punctuation on a page and a stutter out loud.
    t = re.sub(r"^\s*[-•*]\s+", "", t, flags=re.M)
    t = re.sub(r"[\U0001F300-\U0001FAFF☀-➿]", "", t)  # emoji
    t = re.sub(r"\n{2,}", ". ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:2800]  # Polly's per-request ceiling, with room to spare


# ── What the voice is allowed to ASK the page to do ─────────────────────────
#
# Deliberately tiny, and deliberately about the SCREEN rather than the data.
# There is no "create_sale" here: to record a sale the assistant navigates to
# Sales and fills the form, and the form saves it the way it always has. That
# is what makes the automation honest — he watches the same path his own finger
# would take, and every guard on it still applies.
UI_ACTIONS = [
    {
        "name": "go_to",
        "description": (
            "Open a page in the app so the owner can see it. Use for 'take me to', "
            "'open', 'show me the', and BEFORE filling anything in on that page."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "string",
                    "description": (
                        "One of: dashboard, sales, expenses, inventory, purchasing, "
                        "vendors, recipes, reports, money, employees, rota, attendance, "
                        "payroll, orders, tables, menu, staff, documents, waste, stock-take"
                    ),
                }
            },
            "required": ["page"],
        },
    },
    {
        "name": "fill_form",
        "description": (
            "Type values into the form on the page that is already open, and show "
            "them to the owner WITHOUT saving. Always used after go_to. The owner "
            "confirms before anything is written."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "fields": {
                    "type": "object",
                    "description": (
                        "Field name to value, e.g. {\"amount\": \"120\", \"method\": "
                        "\"cash\"}. Use the plainest name for the field you can."
                    ),
                },
                "summary": {
                    "type": "string",
                    "description": "One short sentence saying what is about to be saved.",
                },
            },
            "required": ["fields", "summary"],
        },
    },
]


class VoiceTurn(BaseModel):
    """One thing the owner said, plus what has been said so far."""

    text: str = Field(min_length=1, max_length=2000)
    history: list[dict] = Field(default_factory=list)
    route: str | None = None
    voice: str = DEFAULT_VOICE


PERSONA = (
    "You are DineAI's voice — an actual voice, in a restaurant, being spoken to "
    "out loud by the person who owns the place.\n\n"
    "HOW YOU SOUND. Warm, quick and genuinely funny. You are the friend who "
    "happens to know where every penny went, not a phone menu. Tease gently when "
    "something is funny, be straight when it is not. Never say 'I'd be happy to' "
    "or 'certainly' - nobody talks like that.\n\n"
    "HOW YOU TALK. THIS IS SPEECH:\n"
    "- Two or three sentences. He is standing up, holding something.\n"
    "- Never a list, never a table, never markdown. Say '4 things are low, and "
    "onions are the urgent one' - do not read out four rows.\n"
    "- Say numbers the way a person says them: 'about twelve hundred', not "
    "'1,247.50', unless he asked for the exact figure.\n"
    "- No preamble. Answer first.\n\n"
    "WHAT YOU DO. You do not describe the app, you DRIVE it.\n"
    "- 'take me to sales', 'open expenses', 'show me the rota' -> call go_to. "
    "Telling him where a page is when you could just open it is the one thing "
    "that makes this feel like a phone menu instead of an assistant. Open it, "
    "then say one line about what he is looking at.\n"
    "- 'put a 120 pound cash sale in' -> go_to sales FIRST, then fill_form.\n"
    "- Never claim you have saved anything. You fill it in and he presses the "
    "button: 'filled it in, have a look'.\n\n"
    "WHEN YOU MISHEAR. A kitchen is loud and money is exact. If a number could be "
    "wrong, say it back: 'a hundred and twenty, cash - yes?' Better a second of "
    "checking than a wrong figure in his books.\n\n"
    "YOUR MICROPHONE IS ALWAYS ON. He turned you on and walked away; you are "
    "hearing the whole room, not a question aimed at you. So:\n"
    "- If what you heard was not addressed to you - kitchen talk, someone "
    "else's conversation, half a sentence - reply with exactly NOTHING. Not "
    "'sorry?', not 'I did not catch that'. An assistant that answers the room "
    "is worse than no assistant.\n"
    "- Only speak when you were spoken to, or clearly asked for something."
    "\n\n"
    "DOING WHAT HE ASKED, NOT WHAT IT SOUNDED LIKE. When he asks for something "
    "to be DONE:\n"
    "1. Work out which page it lives on. Sales for takings, Expenses for money "
    "out, Inventory for stock levels, Purchasing for ordering.\n"
    "2. go_to that page FIRST. Always. Filling a form on a page that is not "
    "open puts the numbers nowhere.\n"
    "3. Then fill_form, using the plainest field names you can.\n"
    "If a question has BOTH a question and an instruction in it - 'what is low "
    "and order some onions' - answer the question AND do the action. Do not "
    "pick one. He asked for both because he wanted both."
)


def tools_for_voice(user: User) -> list[dict]:
    """The read tools this person may use, plus the two UI ones.

    Read tools come from the ordinary assistant, so the voice can never see
    anything the same person could not see by typing.

    Two things are dropped rather than kept:

    * every ``propose_*`` tool, because a voice does not get to write. It opens
      the page and fills the form, and the form writes.
    * ``navigate``, which returns a LINK for the model to mention. On a screen
      that is helpful; spoken it is useless, and worse, it would satisfy "take
      me to sales" without the page moving an inch. ``go_to`` is the only way
      to answer that here, so it must be the only one on offer.

    ``query_data`` stays. It is a read - one plain SELECT, a forced LIMIT, a
    read-only transaction and per-tenant views - and it is how "what did we
    spend last month" gets answered at all.
    """
    from app.assistant.tools import tools_for

    written = tools_for(user, None)
    safe = [
        t
        for t in written
        if not t.get("name", "").startswith(("propose_", "commit"))
        and t.get("name") != "navigate"
    ]
    return safe + UI_ACTIONS


def history_for(turns: list[dict]) -> list[dict]:
    """Trim the conversation to what a spoken exchange needs.

    Voice turns are short and the useful context is recent; carrying twenty
    minutes of chat costs money and makes it slower to answer.
    """
    out: list[dict] = []
    for t in turns[-8:]:
        role = "assistant" if t.get("role") == "assistant" else "user"
        content = str(t.get("content") or "")[:1200]
        if content:
            out.append({"role": role, "content": content})
    return out


def action_from(tool_name: str, tool_input: dict[str, Any]) -> dict | None:
    """Turn a tool call into an instruction for the BROWSER, not a write.

    Nothing here touches the database. The browser navigates and types; the
    page's own save button, with its own permission check and its own confirm,
    is the only thing that writes.
    """
    if tool_name == "go_to":
        page = str(tool_input.get("page") or "").strip().lower()
        return {"kind": "navigate", "page": page} if page else None
    if tool_name == "fill_form":
        fields = tool_input.get("fields")
        if not isinstance(fields, dict) or not fields:
            return None
        return {
            "kind": "fill",
            "fields": {str(k): str(v) for k, v in fields.items()},
            "summary": str(tool_input.get("summary") or "").strip(),
        }
    return None


def to_json(value: Any) -> str:
    return json.dumps(value, default=str)[:6000]


# ── Speaking before the sentence is finished ────────────────────────────────
#
# "text response came within 3 sec but voice response is very very late... we
#  need to speed up... user will hate our app."
#
# Measured on the live box: /voice/turn 5.4s, then /voice/speak another 2.4s,
# in series. Nearly eight seconds before a sound, because NOTHING started until
# EVERYTHING had finished — the whole reply had to be written before the first
# word could be synthesised, and the browser had to ask twice.
#
# A person does not wait for their whole thought before starting to say it, and
# neither should this. The reply is cut at sentence boundaries as it streams;
# the first sentence goes to Polly while the model is still writing the second.
# The brain is unchanged — Sonnet, every tool, same answers. Only the order of
# operations moved.
_ENDINGS = ".!?"


def next_sentence(buffer: str, *, at_least: int = 20, force: bool = False) -> tuple[str, str]:
    """Split off a chunk worth speaking. Returns (chunk, what is left).

    ``at_least`` stops us shipping "Yes." to Polly as its own request — the
    per-call overhead would cost more than it saves, and the speech comes out
    chopped. It is deliberately LOW: at 45 characters a perfectly ordinary
    opening line ("We took twelve hundred pounds today.") failed the test and
    the whole reply was held back, which is the exact delay this exists to
    remove. ``force`` is the end of the stream, where whatever remains is the
    last thing to say however short it is.
    """
    if force:
        return buffer.strip(), ""
    for i, ch in enumerate(buffer):
        if ch in _ENDINGS and i + 1 >= at_least:
            # Don't cut mid-number: "1.5 kg" is not the end of a sentence.
            if ch == "." and i + 1 < len(buffer) and buffer[i + 1].isdigit():
                continue
            return buffer[: i + 1].strip(), buffer[i + 1 :]
    return "", buffer


async def system_for(db, user: User, hotel, route: str | None) -> str:
    """Everything the voice needs to know before it opens its mouth.

    "this ai should have all permissions and all action it need to do.. and all
     knowledge base it need to have knowledge of its entire hotel"

    So it is handed the SAME knowledge brief the written assistant gets - every
    page, every term, what each number means - rather than a thinner "voice
    version". A quieter assistant is not a friendlier one, it is just one that
    knows less. The only thing that differs is the delivery: this one is being
    listened to, not read, and PERSONA above is entirely about that.

    The knowledge brief is already scoped to what THIS person may see, so a
    cook's voice and an owner's voice are handed different facts by the same
    call. That is the permission model doing its job one layer earlier than the
    tools do.
    """
    from app.assistant.service import _can, _route_context, _today_line

    try:
        from app.assistant.knowledge import knowledge_brief

        brief = knowledge_brief(_can(user))
    except Exception:  # noqa: BLE001 - never let grounding failure mute the voice
        log.exception("voice knowledge brief failed")
        brief = ""

    where = _route_context(route) if route else ""
    return (
        f"{PERSONA}\n\n{brief}{where}{_today_line(hotel)}\n\n"
        f"You are in {getattr(hotel, 'name', None) or 'this restaurant'}. "
        f"The person talking to you is a {user.role}."
    )


#: What each tool is doing, in words a person would use. The model's own tool
#: names ("search_items", "query_data") are engineering nouns, and a status line
#: that says `query_data` is worse than no status line at all.
_DOING = {
    "go_to": "Opening the page",
    "fill_form": "Filling it in",
    "query_data": "Checking the numbers",
    "search_items": "Looking through your stock",
    "low_stock": "Checking what's low",
    "sales_today": "Checking today's takings",
    "expenses_summary": "Checking what you've spent",
    "who_is_in": "Checking who's in",
    "vendor_prices": "Comparing supplier prices",
    "recipe_cost": "Working out the cost",
}


def doing_label(tool_name: str) -> str:
    """A human sentence for the thing it is about to do.

    Measured on the live box: the first WORD of a reply lands about three
    seconds in, because the model has to decide on a tool, run it, and only
    then start writing. He had already called three seconds too slow. This is
    what fills those three seconds - the tool fires at roughly one second, so
    saying what it is doing turns a silent wait into a visible one.
    """
    if tool_name in _DOING:
        return _DOING[tool_name] + "…"
    pretty = tool_name.replace("_", " ").strip()
    return f"Checking {pretty}…" if pretty else "Working on it…"
