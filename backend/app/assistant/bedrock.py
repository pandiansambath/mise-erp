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

# Bedrock ids carry an `anthropic.` prefix; the `eu.` prefix is an INFERENCE
# PROFILE that keeps inference inside EU regions (right for UK client data).
#
# Sonnet 4.6 rather than Sonnet 5 for now: both are subscribed, but a freshly
# accepted Marketplace agreement takes a while to entitle, and Sonnet 5 still
# answers AccessDenied. 4.6 is live today with a 6M tokens/min quota. Flip to
# Sonnet 5 by setting BEDROCK_MODEL_ID — no code change needed.
# Kept in step with the plan registry so there is ONE answer to "which model".
DEFAULT_MODEL = "eu.anthropic.claude-sonnet-4-6"


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


def _invoke_raw(
    body: dict[str, Any],
    meter: dict[str, Any] | None = None,
    model: str = "",
) -> dict[str, Any]:
    """The full Bedrock response. The tool-use loop needs the content blocks,
    not just the text, so it can see what the model wants to call."""
    try:
        model_id = model or _model_id()
        resp = _client().invoke_model(modelId=model_id, body=json.dumps(body))
        payload = json.loads(resp["body"].read())
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller as 503
        msg = str(exc)
        if "AccessDenied" in msg or "not available" in msg:
            raise BedrockUnavailable(
                "Claude isn't switched on for this AWS account yet."
            ) from exc
        log.warning("bedrock invoke failed: %s", msg)
        raise BedrockUnavailable("The AI service is unavailable right now.") from exc
    if meter is not None:
        usage = payload.get("usage") or {}
        meter["model"] = model or _model_id()
        meter["input_tokens"] = int(usage.get("input_tokens") or 0)
        meter["output_tokens"] = int(usage.get("output_tokens") or 0)
        meter["cache_read_tokens"] = int(usage.get("cache_read_input_tokens") or 0)
        meter["cache_write_tokens"] = int(usage.get("cache_creation_input_tokens") or 0)
    return payload


def _invoke(
    body: dict[str, Any],
    meter: dict[str, Any] | None = None,
    model: str = "",
) -> str:
    """POST a Messages-API body to Bedrock and return the concatenated text.

    `meter` is an optional dict the caller passes in to receive the token counts
    Bedrock reports. Tokens are money, so every real call should meter itself —
    see `app.assistant.guard`.

    `model` overrides the configured model. The caller passes the one the
    hotel's PLAN entitles it to, which is how the cheap tier runs on Haiku."""
    try:
        model_id = model or _model_id()
        resp = _client().invoke_model(modelId=model_id, body=json.dumps(body))
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
    if meter is not None:
        usage = payload.get("usage") or {}
        meter["model"] = model or _model_id()
        meter["input_tokens"] = int(usage.get("input_tokens") or 0)
        meter["output_tokens"] = int(usage.get("output_tokens") or 0)
        # cached input is billed at a fraction of normal input; track it so the
        # saving is something we can see rather than something we assume
        meter["cache_read_tokens"] = int(usage.get("cache_read_input_tokens") or 0)
        meter["cache_write_tokens"] = int(usage.get("cache_creation_input_tokens") or 0)
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


def _cached_system(text: str) -> list[dict[str, Any]]:
    """Mark a system prompt as cacheable.

    The rules and this hotel's item catalogue are byte-identical on every call,
    so Bedrock can keep them warm: a cache READ costs ~0.1x normal input, which
    is where the margin on the AI tiers comes from.

    The trade-off, honestly: a cache WRITE costs ~1.25x, and entries live about
    five minutes. So this pays when someone scans a few bills or holds a
    conversation, and costs a fraction more for a single isolated call. That's
    the right bet — bursts are the normal shape of both scanning and chat.

    Below roughly 1-2k tokens Bedrock ignores the marker and simply bills
    normally, so short prompts lose nothing by asking.
    """
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


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
    meter: dict[str, Any] | None = None,
    model: str = "",
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
        "system": _cached_system(_EXTRACT_SYSTEM + context),
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
    data = _json_from(_invoke(body, meter, model))
    data.setdefault("doc_type", kind if kind != "auto" else "bill")
    return data


# ── 2. The in-app assistant ─────────────────────────────────────────────────

_ASSISTANT_SYSTEM = """You are DineAI, the assistant inside a restaurant's own management system.
You work for ONE restaurant: {hotel}. Everything you say is about THEIR kitchen.

What you help with: stock, suppliers and prices, recipes and dish costs, menus and
orders, sales and takings, expenses and profit, staff, rotas, attendance, payroll,
food safety and compliance, and how to use DineAI itself. Practical suggestions for
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
  on DineAI, and must never speculate about one.
- Use the FIGURES YOU ARE GIVEN. Never invent a number, price or date; if you
  don't have it, say what you'd need and where they can find it.
- Money is the point of this product: when numbers are involved, be exact, show
  your working briefly, and flag anything that looks like a loss.
- Be concise and warm. Write like an experienced restaurant manager talking to a
  busy owner, not like a chatbot."""


def ask(
    question: str,
    *,
    hotel_name: str,
    context: str = "",
    history: list[dict] | None = None,
    meter: dict[str, Any] | None = None,
    model: str = "",
    system_extra: str = "",
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
            "system": _cached_system(
                _ASSISTANT_SYSTEM.format(hotel=hotel_name)
                + (f"\n\n{system_extra}" if system_extra else "")
            ),
            "messages": messages,
        },
        meter,
        model,
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
