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

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import BaseModel, Field

from app.auth.models import User

log = logging.getLogger("mise.voice")

#: Six voices, three of each, as he asked. Polly's names mean nothing to an
#: owner, so each carries the word a person would actually use to pick one.
VOICES: list[dict[str, str]] = [
    {"id": "Amy", "label": "Amy", "who": "British, warm",
     "sex": "female", "engine": "neural"},
    {"id": "Danielle", "label": "Danielle", "who": "American, bright",
     "sex": "female", "engine": "neural"},
    {"id": "Kajal", "label": "Kajal", "who": "Indian English, easy",
     "sex": "female", "engine": "neural"},
    {"id": "Arthur", "label": "Arthur", "who": "British, calm",
     "sex": "male", "engine": "neural"},
    {"id": "Matthew", "label": "Matthew", "who": "American, friendly",
     "sex": "male", "engine": "neural"},
    {"id": "Stephen", "label": "Stephen", "who": "American, upbeat",
     "sex": "male", "engine": "neural"},
]
DEFAULT_VOICE = "Amy"


def _polly():
    return boto3.client("polly", region_name="eu-west-2")


def speak(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Turn a reply into MP3.

    Polly is told to read it as speech, not as a document: the assistant's
    written answers are full of markdown and £ signs, and "asterisk asterisk
    Butter Chicken" is not a friendly tone of voice.
    """
    chosen = next((v for v in VOICES if v["id"] == voice), None) or VOICES[0]
    clean = spoken_form(text)
    try:
        out = _polly().synthesize_speech(
            Text=clean,
            OutputFormat="mp3",
            VoiceId=chosen["id"],
            Engine=chosen["engine"],
        )
        return out["AudioStream"].read()
    except (BotoCoreError, ClientError):
        log.exception("polly failed")
        raise


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
        "input_schema": {
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
        "input_schema": {
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
    "WHAT YOU DO. You can open pages and fill forms for him. When he asks you to "
    "record something: go_to the right page FIRST, then fill_form. Never claim "
    "you have saved anything - you fill it in and he presses the button. Say so: "
    "'filled it in, have a look'.\n\n"
    "WHEN YOU MISHEAR. A kitchen is loud and money is exact. If a number could be "
    "wrong, say it back: 'a hundred and twenty, cash - yes?' Better a second of "
    "checking than a wrong figure in his books."
)


def tools_for_voice(user: User) -> list[dict]:
    """The read tools this person may use, plus the two UI ones.

    Read tools come from the ordinary assistant, so the voice can never see
    anything the same person could not see by typing.
    """
    from app.assistant.tools import tools_for

    written = tools_for(user, None)
    safe = [
        t
        for t in written
        if not any(
            w in t.get("name", "")
            for w in ("propose", "create", "update", "delete", "commit", "query_data")
        )
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
