"""The LLM call — Google Gemini, via its REST API (no SDK dependency).

Kept deliberately model-agnostic: ``generate()`` takes a system prompt, the chat
history, the tool schemas and an ``execute`` callback, runs the tool-calling
loop, and returns the final text + which tools fired. Swapping to Groq/OpenAI
later means writing one more ``generate`` variant — nothing else changes.

httpx is imported lazily so the dependency is only needed when a key is set.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.config import settings

log = logging.getLogger("mise.assistant")

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_MAX_HOPS = 5  # cap tool-call round-trips so we can never loop forever

ExecuteFn = Callable[[str, dict], Awaitable[dict]]


class ProviderError(RuntimeError):
    """Raised on any LLM transport/parse failure so the caller can fall back."""


def _keys() -> list[str]:
    """All configured Gemini keys, in fallback order (primary first)."""
    return [k for k in (settings.gemini_api_key, settings.gemini_api_key_2) if k]


def is_configured() -> bool:
    return bool(_keys())


async def post_gemini(client, url: str, body: dict):
    """POST to Gemini, rotating through configured keys on a 429 (rate limit) so a
    busy key falls back to the next. Returns the httpx response (the last 429 if
    every key is rate-limited). Shared by the chat loop and the document reader."""
    keys = _keys()
    if not keys:
        raise ProviderError("no api key")
    last = None
    for key in keys:
        resp = await client.post(url, params={"key": key}, json=body)
        if resp.status_code == 429:  # this key is rate-limited — try the next
            last = resp
            continue
        return resp
    return last


def _to_contents(history: list[dict]) -> list[dict]:
    """Map our {role, content} messages to Gemini contents."""
    out = []
    for m in history:
        role = "model" if m["role"] == "assistant" else "user"
        out.append({"role": role, "parts": [{"text": m["content"]}]})
    return out


async def generate(
    *, system: str, history: list[dict], tools: list[dict], execute: ExecuteFn,
    attachment: dict | None = None,
) -> tuple[str, list[str]]:
    """Run one assistant turn (with tool calls) and return (reply_text, used_tools).

    `attachment` (a {mime, data} bill/receipt/photo) is added to the latest user
    message so the model can read it and propose the right action."""
    if not is_configured():
        raise ProviderError("no api key")

    try:
        import httpx
    except ImportError as exc:  # never 500 — degrade to the deterministic fallback
        raise ProviderError("httpx not installed") from exc

    url = _ENDPOINT.format(model=settings.assistant_model)
    contents = _to_contents(history)
    if attachment and contents:
        contents[-1]["parts"].append(
            {"inline_data": {"mime_type": attachment["mime"], "data": attachment["data"]}}
        )
    body: dict[str, Any] = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": contents,
        "tools": [{"function_declarations": tools}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 900},
    }

    used: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for _ in range(_MAX_HOPS):
                resp = await post_gemini(client, url, body)
                if resp.status_code >= 300:
                    raise ProviderError(f"gemini {resp.status_code}: {resp.text[:300]}")
                data = resp.json()
                candidates = data.get("candidates") or []
                if not candidates:
                    raise ProviderError("no candidates in response")
                content = candidates[0].get("content") or {}
                parts = content.get("parts") or []

                calls = [p["functionCall"] for p in parts if "functionCall" in p]
                if calls:
                    # record the model's tool-call turn, then answer each call
                    body["contents"].append(content)
                    fr_parts = []
                    for call in calls:
                        name = call.get("name", "")
                        args = call.get("args", {}) or {}
                        result = await execute(name, args)
                        used.append(name)
                        fr_parts.append(
                            {"functionResponse": {"name": name, "response": result}}
                        )
                    body["contents"].append({"role": "user", "parts": fr_parts})
                    continue

                text = "".join(p.get("text", "") for p in parts).strip()
                if not text:
                    raise ProviderError("empty text in response")
                return text, used
        raise ProviderError("exceeded tool-call hops")
    except ProviderError:
        raise
    except Exception as exc:  # noqa: BLE001 — network/JSON errors → fall back
        raise ProviderError(str(exc)) from exc
