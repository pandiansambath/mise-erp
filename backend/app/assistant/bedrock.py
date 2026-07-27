"""Claude on Amazon Bedrock — the Copilot's brain.

Why Bedrock and not a public API: the images we send are CLIENT DATA (supplier
invoices, handwritten recipes). On Bedrock the call never leaves the hotel's own
AWS account, and the EC2 instance role authenticates it, so there's no API key to
leak. boto3 is imported lazily so the app boots fine without it.

Two jobs live here:
  * `understand_document` — read a photographed bill or handwritten recipe and
    return STRUCTURED JSON for a human to confirm before anything is saved.
  * `ask` — the in-app assistant, hard-scoped to this hotel's own operations.

Nothing here writes to the database. Extraction proposes; a human disposes.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

from app.core.config import settings

log = logging.getLogger("mise.bedrock")

# Anthropic's Bedrock ids carry an `anthropic.` prefix.
DEFAULT_MODEL = "anthropic.claude-sonnet-5"


class BedrockUnavailable(RuntimeError):
    """Raised when Bedrock can't be reached or model access isn't granted yet."""


def _client():
    try:
        import boto3  # imported lazily — the app runs fine without it
    except ImportError as exc:  # pragma: no cover - dependency always shipped
        raise BedrockUnavailable("boto3 is not installed") from exc
    return boto3.client("bedrock-runtime", region_name=settings.aws_region)


def _model_id() -> str:
    return (getattr(settings, "bedrock_model_id", "") or DEFAULT_MODEL).strip()


def _invoke(body: dict[str, Any]) -> str:
    """POST a Messages-API body to Bedrock and return the concatenated text."""
    try:
        resp = _client().invoke_model(modelId=_model_id(), body=json.dumps(body))
        payload = json.loads(resp["body"].read())
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller as 503
        msg = str(exc)
        if "AccessDenied" in msg or "not available" in msg:
            raise BedrockUnavailable(
                "Claude isn't switched on for this AWS account yet — enable model "
                "access for Anthropic in the Bedrock console (one-time)."
            ) from exc
        log.warning("bedrock invoke failed: %s", msg)
        raise BedrockUnavailable("The AI service is unavailable right now.") from exc
    return "".join(b.get("text", "") for b in payload.get("content", []))


def _json_from(text: str) -> dict[str, Any]:
    """Claude is told to answer with pure JSON; be forgiving if it wraps it."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    raise BedrockUnavailable("The AI returned something we couldn't read. Try again.")


# ── 1. Document understanding (bills + handwritten recipes) ──────────────────

_BILL_SCHEMA = """{
  "doc_type": "bill",
  "vendor_name": string|null,
  "invoice_number": string|null,
  "date": "YYYY-MM-DD"|null,
  "currency": string|null,
  "total": number|null,
  "lines": [
    {"name": string, "qty": number|null, "unit": string|null,
     "unit_price": number|null, "line_total": number|null,
     "matched_item_id": string|null, "confident": boolean}
  ],
  "notes": string|null
}"""

_RECIPE_SCHEMA = """{
  "doc_type": "recipe",
  "name": string|null,
  "serves": number|null,
  "ingredients": [
    {"name": string, "qty": number|null, "unit": string|null,
     "matched_item_id": string|null, "confident": boolean}
  ],
  "steps": [string],
  "notes": string|null
}"""

_EXTRACT_SYSTEM = """You read photographs of restaurant paperwork and turn them into \
structured data.

Rules that matter more than being helpful:
- NEVER invent a number. If a price, quantity or date is unreadable, use null and
  set "confident": false for that line. A missing value is fine; a wrong one is not
  — these figures become the restaurant's costs.
- Copy amounts exactly as printed. Do not convert currencies or recalculate totals.
- Match a line to one of the KNOWN ITEMS only when it is clearly the same thing;
  put its id in "matched_item_id" and otherwise leave it null.
- Handwriting: transcribe what is actually written, including local ingredient
  names. If a word is ambiguous, choose the likeliest and set "confident": false.

Reply with JSON only — no prose, no code fences."""


def understand_document(
    image_bytes: bytes,
    media_type: str,
    *,
    kind: str = "auto",
    known_items: list[dict] | None = None,
    known_vendors: list[str] | None = None,
) -> dict[str, Any]:
    """Read a bill or handwritten recipe into structured, human-confirmable data.

    `known_items` / `known_vendors` come from THIS hotel only, so matching
    can never reach across tenants.
    """
    schema = {"bill": _BILL_SCHEMA, "recipe": _RECIPE_SCHEMA}.get(kind)
    if schema is None:
        schema = (
            "either\n" + _BILL_SCHEMA + "\nor\n" + _RECIPE_SCHEMA +
            '\nPick by what the photo actually shows and set "doc_type" accordingly.'
        )

    context = ""
    if known_items:
        listing = "\n".join(
            f'- {i["name"]} (id={i["id"]}, unit={i.get("unit") or "?"})' for i in known_items[:250]
        )
        context += f"\n\nKNOWN ITEMS in this kitchen:\n{listing}"
    if known_vendors:
        context += "\n\nKNOWN SUPPLIERS: " + ", ".join(known_vendors[:120])

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 4096,
        "system": _EXTRACT_SYSTEM + context,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": base64.standard_b64encode(image_bytes).decode(),
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Read this document and return JSON in exactly this shape:\n"
                            + schema
                        ),
                    },
                ],
            }
        ],
    }
    data = _json_from(_invoke(body))
    data.setdefault("doc_type", kind if kind != "auto" else "bill")
    return data


# ── 2. The in-app assistant ─────────────────────────────────────────────────

_ASSISTANT_SYSTEM = """You are Mise, the assistant inside a restaurant's own management system.
You work for ONE restaurant: {hotel}. Everything you say is about THEIR kitchen.

What you help with: stock, suppliers and prices, recipes and dish costs, menus and
orders, sales and takings, expenses and profit, staff, rotas, attendance, payroll,
food safety and compliance, and how to use Mise itself. Practical suggestions for
running the place better are welcome and encouraged.

Staying on topic — this matters:
If asked something unrelated to running this restaurant (politics, celebrities,
general trivia, homework, world news), do NOT answer it, even if you know it.
Say so warmly, in one short line, and offer what you CAN do — for example:
"That one's outside my kitchen! I stick to {hotel} — but ask me about tonight's
prep, this week's margins or who's on the rota and I'm all yours."
Never be preachy or robotic about it; one friendly line, then move on.

Other rules:
- You only ever see {hotel}'s data. You have no knowledge of any other restaurant
  on Mise, and must never speculate about one.
- Use the FIGURES YOU ARE GIVEN. Never invent a number, price or date; if you
  don't have it, say what you'd need and where they can find it.
- Money is the point of this product: when numbers are involved, be exact, show
  your working briefly, and flag anything that looks like a loss.
- Be concise and warm. Write like an experienced restaurant manager talking to a
  busy owner, not like a chatbot."""


def ask(
    question: str, *, hotel_name: str, context: str = "", history: list[dict] | None = None,
) -> str:
    """Answer a question about THIS hotel. `context` is caller-supplied facts
    (already scoped to the hotel) — the model must not go looking elsewhere."""
    messages: list[dict[str, Any]] = []
    for turn in (history or [])[-8:]:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        text = str(turn.get("text", ""))
        messages.append({"role": role, "content": [{"type": "text", "text": text}]})
    user_text = question if not context else f"{question}\n\n<facts>\n{context}\n</facts>"
    messages.append({"role": "user", "content": [{"type": "text", "text": user_text}]})

    return _invoke(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1500,
            "system": _ASSISTANT_SYSTEM.format(hotel=hotel_name),
            "messages": messages,
        }
    ).strip()


def health() -> dict[str, Any]:
    """Is the brain switched on? Used by the status endpoint + the UI banner."""
    try:
        _invoke(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 8,
                "messages": [{"role": "user", "content": [{"type": "text", "text": "ok"}]}],
            }
        )
        return {"configured": True, "model": _model_id(), "region": settings.aws_region}
    except BedrockUnavailable as exc:
        return {
            "configured": False,
            "model": _model_id(),
            "region": settings.aws_region,
            "reason": str(exc),
        }
