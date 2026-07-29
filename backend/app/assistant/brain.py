"""The brain: Claude on Bedrock, with tools.

This replaces the Gemini provider entirely. One model family, chosen by the
hotel's PLAN — Haiku on Starter, Sonnet on Pro and Enterprise — so there is a
single place to reason about behaviour, cost and privacy, and no silent fallback
to a scripted reply when a third-party key happens to be missing.

It runs a real tool-use loop, which is the difference between an assistant that
describes the app and one that reads your actual numbers and acts on them.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.assistant import bedrock

log = logging.getLogger("mise.assistant.brain")

ExecuteFn = Callable[[str, dict], Awaitable[dict]]

# How many times the model may call tools before we make it answer. Each lap is
# a billed round-trip, and anything needing more than this is usually a loop.
MAX_LAPS = 4


class BrainError(RuntimeError):
    """The model could not be reached. Callers degrade rather than 500."""


def _to_anthropic_tools(tools: list[dict]) -> list[dict]:
    """Our tool schemas are already OpenAI-ish; Anthropic wants input_schema."""
    return [
        {
            "name": t["name"],
            "description": t.get("description", ""),
            "input_schema": t.get("parameters") or {"type": "object", "properties": {}},
        }
        for t in tools
    ]


async def generate(
    *,
    system: str,
    history: list[dict],
    tools: list[dict],
    execute: ExecuteFn,
    attachment: dict | None = None,
    model: str = "",
    meter: dict[str, Any] | None = None,
) -> tuple[str, list[str]]:
    """One assistant turn, tools included. Returns (reply, tools it used)."""
    messages: list[dict[str, Any]] = []
    for turn in history[-12:]:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        messages.append(
            {"role": role, "content": [{"type": "text", "text": str(turn.get("content", ""))}]}
        )

    # The attachment rides on the newest user message so the model reads it in
    # context. Claude handles images AND pdfs natively; anything else is decoded
    # as text. Previously a non-image was dropped silently — the file appeared
    # to upload and the model was then asked about nothing.
    if attachment and messages:
        data = attachment.get("data") or ""
        mime = (attachment.get("mime") or "").split(";")[0]
        name = attachment.get("name") or "the file"
        if data:
            if mime.startswith("image/"):
                messages[-1]["content"].insert(
                    0,
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": mime, "data": data},
                    },
                )
            elif mime == "application/pdf" or name.lower().endswith(".pdf"):
                messages[-1]["content"].insert(
                    0,
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": data,
                        },
                    },
                )
            else:
                # Plain text, CSV, JSON, logs — decode and hand it over rather
                # than refusing a file the model could easily read.
                import base64 as _b64

                try:
                    text_body = _b64.b64decode(data).decode("utf-8", "replace")[:60000]
                except Exception:  # noqa: BLE001
                    text_body = ""
                if text_body.strip():
                    messages[-1]["content"].insert(
                        0,
                        {"type": "text", "text": f"CONTENTS OF {name}:\n{text_body}"},
                    )
                else:
                    messages[-1]["content"].insert(
                        0,
                        {
                            "type": "text",
                            "text": (
                                f"The user attached {name} ({mime or 'unknown type'}), "
                                "which could not be read as text. Say so plainly and "
                                "ask them to send it as a PDF, photo or spreadsheet."
                            ),
                        },
                    )

    spec = _to_anthropic_tools(tools)
    used: list[str] = []

    for lap in range(MAX_LAPS):
        body: dict[str, Any] = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1600,
            "system": bedrock._cached_system(system),
            "messages": messages,
        }
        if spec:
            body["tools"] = spec

        try:
            payload = bedrock._invoke_raw(body, meter, model)
        except bedrock.BedrockUnavailable as exc:
            raise BrainError(str(exc)) from exc

        blocks = payload.get("content", [])
        calls = [b for b in blocks if b.get("type") == "tool_use"]
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()

        if not calls:
            return text, used

        # Run what it asked for, hand back the results, let it continue.
        messages.append({"role": "assistant", "content": blocks})
        results = []
        for c in calls:
            name = c.get("name", "")
            used.append(name)
            try:
                out = await execute(name, c.get("input") or {})
            except Exception as exc:  # noqa: BLE001 — one bad tool must not kill the turn
                log.warning("tool %s failed", name, exc_info=True)
                out = {"error": str(exc)[:200]}
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": c.get("id"),
                    "content": json.dumps(out, default=str)[:6000],
                }
            )
        messages.append({"role": "user", "content": results})

        if lap == MAX_LAPS - 1:
            # Out of laps: make it answer from what it already has rather than
            # returning nothing after spending several calls.
            body["messages"] = messages
            body.pop("tools", None)
            try:
                payload = bedrock._invoke_raw(body, meter, model)
                return (
                    "".join(
                        b.get("text", "") for b in payload.get("content", []) if b.get("text")
                    ).strip(),
                    used,
                )
            except bedrock.BedrockUnavailable as exc:
                raise BrainError(str(exc)) from exc

    return "", used
