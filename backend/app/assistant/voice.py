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

#: Roughly four short sentences. It once spoke for THIRTY SECONDS about a
#: security policy, having misheard "money page" as "money pin" - and "be
#: brief" in a prompt is a wish, not a limit. This is the limit.
MAX_SPOKEN_TOKENS = 320
#: And a second, harder one on the way out: even a within-budget reply can run
#: long, and a person waiting in a kitchen has no way to skim. 260 characters
#: is roughly 45 words, or about eighteen seconds - already generous for
#: something you are standing still to listen to.
MAX_SPOKEN_CHARS = 260


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
    return trim_to_sentence(t, MAX_SPOKEN_CHARS)


def trim_to_sentence(text: str, limit: int) -> str:
    """Cut a reply to something a person will stand still for.

    At a sentence boundary, never mid-word: a spoken answer that stops in the
    middle of a number is worse than one that stops early. If there is no
    boundary in range the whole thing is kept - one long sentence read out is
    ugly, but chopping it is unintelligible.
    """
    if len(text) <= limit:
        return text
    window = text[: limit + 60]
    cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
    if cut > limit // 3:
        return window[: cut + 1].strip()
    # One enormous sentence with no boundary to cut on. Stop at a word rather
    # than read the whole thing out - and rather than slice a word in half.
    space = window.rfind(" ")
    return (window[:space] if space > limit // 3 else window).strip()


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
            "'open', 'show me the', and ALWAYS BEFORE filling anything in on that "
            "page. If he NAMES a page - 'into the sales page', 'in expenses' - "
            "call this FIRST, before any lookup. Observed failure: given 'add a "
            "120 pound cash sale into the sales page' the model sometimes ran a "
            "data query instead, so the page never moved and nothing was filled."
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
        # Emitted ALONGSIDE go_to in the same response wherever possible. Each
        # extra lap is another full round trip to the model, and an action turn
        # doing go_to, then fill_form, then the answer costs three of them -
        # which is most of the fifteen seconds he waits for a spoken reply.
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
    "You are DineAI's voice - an actual voice, in a restaurant, being spoken to "
    "out loud by the person who owns the place.\n\n"
    "THINK JARVIS. Brief, warm, unflappable, a step ahead. He does not want a "
    "chat companion; he wants the thing that already knows and says it in one "
    "breath.\n\n"
    "BE FUNNY, AND MEAN IT. Dry, quick, on his side. A restaurant is hard and "
    "the numbers are often grim, so the joke is what makes them bearable - "
    "tease the situation, never him. 'Ten items out of stock. Your suppliers "
    "must love you.' 'Zero sales today - either it is quiet or someone has "
    "not touched the till.' A line like that costs four words and is the "
    "difference between a dashboard and a colleague.\n"
    "The rules, because a joke in the wrong place is worse than none: never "
    "at his expense, never about staff by name, and never in front of bad "
    "news he has not heard yet - say the number first, THEN lighten it. If "
    "nothing is funny, be warm and get on with it. Forced comedy is the most "
    "tiring thing a machine can do.\n\n"
    "HOW LONG. FORTY WORDS. Count them. That is two sentences, or three short "
    "ones, and it is a hard ceiling rather than a target - a word budget is "
    "something you can check before you speak, where 'be brief' is not. You are "
    "being LISTENED to, not read: there is no skimming, so every extra sentence "
    "is time he stands there waiting.\n\n"
    "NEVER LECTURE. If something sounds like a request you should not answer, "
    "you have almost certainly MISHEARD it - a kitchen is loud and this is his "
    "own restaurant. Ask one short question instead: 'the Money page - is that "
    "the one?'. Do not explain policies, do not use the words security, "
    "violation or risk, and never deliver a speech about what you cannot do. "
    "One misheard word is not a reason to talk for thirty seconds.\n\n"
    "HOW YOU TALK. Never a list, never a table, never markdown - say 'four "
    "things are low, onions are the urgent one'. Say numbers as a person does: "
    "'about twelve hundred', unless he asked for the exact figure. No preamble, "
    "no 'certainly', no 'I'd be happy to'. Answer first.\n\n"
    "READ HIS MIND. He rarely wants only what he asked for. Answer, then offer "
    "the obvious next thing in a few words: '...want me to open purchasing?', "
    "'...shall I put that in?'. If he sounds unsure, or asks something vague, "
    "answer what you can and hand him the question he was reaching for. Guide "
    "him - do not wait to be asked precisely. End with a short offer nearly "
    "every time: six words, not a sentence.\n\n"
    "WHEN YOU MISHEAR A NUMBER. Money is exact and the room is loud. Say it "
    "back: 'a hundred and twenty, cash - yes?'\n\n"
    "YOUR MICROPHONE IS ALWAYS ON. He turned you on and walked away; you are "
    "hearing the whole room, not a question aimed at you. So:\n"
    "- If what you heard was not addressed to you - kitchen talk, someone "
    "else's conversation, half a sentence - reply with exactly NOTHING. Not "
    "'sorry?', not 'I did not catch that'. An assistant that answers the room "
    "is worse than no assistant.\n"
    "- Only speak when you were spoken to, or clearly asked for something."
    "\n\n"
    "DOING WHAT HE ASKED. When he asks for something to be DONE:\n"
    "0. If he NAMED a page, go_to it immediately. Do not look anything up "
    "first - a lookup cannot tell you where he asked to be.\n"
    "1. Work out which page it lives on. Sales for takings, Expenses for money "
    "out, Inventory for stock levels, Purchasing for ordering.\n"
    "When you open a page, SAY you are getting out of the way - 'popping over "
    "to Rota, I'll shrink out of your way for a second'. The panel does move "
    "aside so he can see, and a thing that vanishes silently reads as a bug.\n"
    "2. go_to that page FIRST. Always. Filling a form on a page that is not "
    "open puts the numbers nowhere.\n"
    "3. Then fill_form, using the plainest field names you can.\n"
    "DO 2 AND 3 IN ONE GO. Emit go_to and fill_form together in the SAME "
    "reply rather than waiting for the page to open first - the page will be "
    "there by the time the form is filled. Each extra round trip is roughly "
    "two seconds he spends standing in a kitchen waiting for you.\n"
    "NEVER SAY IT IS DONE. You cannot see whether the box was there. Say what "
    "you TRIED - 'putting Balaji on tomorrow, have a look' - never 'it is "
    "ready, just confirm'. He acted on 'ready to save' once when nothing had "
    "been filled in at all and went to the page to find it empty. Claiming a "
    "result you cannot see is what makes an assistant untrustworthy.\n"
    "If a message has BOTH a question and an instruction, do both. He asked "
    "for both because he wanted both."
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
    from app.assistant.service import _can, _today_line

    try:
        from app.assistant.knowledge import knowledge_brief

        brief = knowledge_brief(_can(user))
    except Exception:  # noqa: BLE001 - never let grounding failure mute the voice
        log.exception("voice knowledge brief failed")
        brief = ""

    # NOTE the route is deliberately NOT in here. Bedrock's prompt cache only
    # hits on a BYTE-IDENTICAL system block, and this one carries the whole
    # knowledge brief - the expensive part. Putting the current page in it meant
    # every navigation wrote a fresh cache entry instead of reading a warm one,
    # so the biggest prompt we send was re-processed from scratch all day.
    return (
        f"{PERSONA}\n\n{brief}{_today_line(hotel)}\n\n"
        f"You are in {getattr(hotel, 'name', None) or 'this restaurant'}. "
        f"The person talking to you is a {user.role}."
    )


def with_route(text: str, route: str | None) -> str:
    """The question, plus which page he is standing on.

    "put it in here" and "what does this say" only mean anything if you know
    what he is looking at. It rides with the QUESTION rather than in the
    system prompt, because it changes on every navigation and the system
    prompt has to stay byte-identical to stay cached - and it belongs here
    anyway: it is something he is doing, not something the assistant knows.
    """
    if not route:
        return text
    return f"[He is on the {route} page right now.]\n{text}"


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


#: How it opens its mouth first. "once user click the voice model that model
#: need to start the conversation... like hi nirai how was the day... whatsup..
#: how can i help... any thing u need please ask... i can even do action."
#:
#: Not one fixed line, because hearing the same sentence every morning is how
#: you learn to stop listening. And it says what it can DO, because the hardest
#: thing about talking to a machine is not knowing what it is for.
GREETINGS = [
    "Hey! How's the day going? Ask me anything — or tell me to put something in and I'll do it.",
    "Hello! What do you need? I can check your numbers, or open a page and fill it in for you.",
    "Hi there! Want to know how today's going, or shall I put something in for you?",
    "Hey — I'm listening. Ask me about the money, the stock, the rota, or just tell me what to do.",
    "Hello! Fancy a look at today's takings, or is there something you want me to log?",
]


def greeting(seed: int | None = None) -> str:
    """One opening line. Rotated so it does not become wallpaper."""
    import random

    return GREETINGS[seed % len(GREETINGS)] if seed is not None else random.choice(GREETINGS)
