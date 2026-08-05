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
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from app.assistant import bedrock, streaming

log = logging.getLogger("mise.assistant.brain")

ExecuteFn = Callable[[str, dict], Awaitable[dict]]

# How many times the model may call tools before we make it answer. Each lap is
# a billed round-trip, and anything needing more than this is usually a loop.
MAX_LAPS = 4


def _brief(payload: dict) -> str:
    """One short line describing what a tool was asked for.

    Trimmed hard: this is shown to a restaurant owner, not logged for a
    developer, and a wall of JSON is worse than nothing. Long values are cut
    because a pasted price list would otherwise fill the panel.
    """
    if not payload:
        return ""
    bits = []
    for key, value in list(payload.items())[:3]:
        text = str(value)
        bits.append(f"{key}: {text[:60]}{'…' if len(text) > 60 else ''}")
    return " · ".join(bits)




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


def build_messages(
    history: list[dict],
    attachment: dict | None = None,
) -> list[dict[str, Any]]:
    """Turn the conversation (and any attachment) into Anthropic messages.

    Shared by the buffered and streaming paths. Kept in one place because the
    attachment handling below is the fiddliest code in this file and already
    had a bug where a non-image file uploaded, was dropped, and the model was
    then asked about nothing.
    """
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

    return messages


async def generate(
    *,
    system: str,
    history: list[dict],
    tools: list[dict],
    execute: ExecuteFn,
    attachment: dict | None = None,
    model: str = "",
    meter: dict[str, Any] | None = None,
    # Filled in as it works, so the caller can show what happened rather than a
    # spinner. Optional: nothing depends on it being collected.
    trace: list[dict] | None = None,
) -> tuple[str, list[str]]:
    """One assistant turn, tools included. Returns (reply, tools it used)."""
    messages = build_messages(history, attachment)
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
        # What it said to itself before reaching for tools. Users waiting on a
        # slow answer deserve to see the work, not a spinner — and this is the
        # only place that reasoning exists before it is thrown away.
        if text and trace is not None:
            trace.append({"kind": "thought", "text": text[:400]})
        results = []
        for c in calls:
            name = c.get("name", "")
            used.append(name)
            if trace is not None:
                trace.append({"kind": "tool", "name": name, "input": _brief(c.get("input") or {})})
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


async def generate_stream(
    *,
    system: str,
    history: list[dict],
    tools: list[dict],
    execute: ExecuteFn,
    attachment: dict | None = None,
    model: str = "",
    meter: dict[str, Any] | None = None,
) -> AsyncIterator[dict]:
    """The same turn, narrated as it happens.

    Yields, in order: `thought` and `tool` events while it works, `delta`
    events as the reply is written, and one final `done` carrying the whole
    text so the client never has to reassemble fragments it may have missed.

    Why the deltas are held back on early laps: you cannot know whether a lap
    ends in an answer or a tool call until the blocks arrive. Forwarding text
    from a lap that then calls a tool would type the model's private "let me
    check the sales" out as if it were the reply.
    """
    messages = build_messages(history, attachment)
    spec = _to_anthropic_tools(tools)
    used: list[str] = []
    queue: list[str] = []

    async def emit(piece: str) -> None:
        queue.append(piece)

    for lap in range(MAX_LAPS):
        body: dict[str, Any] = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1600,
            "system": bedrock._cached_system(system),
            "messages": messages,
        }
        # The last lap gets no tools: it must answer from what it has rather
        # than spending another round-trip it does not have left.
        if spec and lap < MAX_LAPS - 1:
            body["tools"] = spec

        queue.clear()
        try:
            text, calls, usage = await streaming._one_lap(body, model, on_delta=emit)
        except bedrock.BedrockUnavailable as exc:
            raise BrainError(str(exc)) from exc

        if meter is not None:
            meter["model"] = model or bedrock._model_id()
            for key, value in usage.items():
                meter[key] = meter.get(key, 0) + value

        if not calls:
            # This lap WAS the answer. Everything buffered is real reply text.
            for piece in queue:
                yield {"type": "delta", "text": piece}
            yield {"type": "done", "text": text, "tools": used}
            return

        # Otherwise it is thinking out loud on the way to a tool.
        if text.strip():
            yield {"type": "thought", "text": text.strip()[:400]}

        blocks: list[dict] = []
        if text.strip():
            blocks.append({"type": "text", "text": text})
        blocks.extend(calls)
        messages.append({"role": "assistant", "content": blocks})

        results = []
        for c in calls:
            name = c.get("name", "")
            used.append(name)
            yield {"type": "tool", "name": name, "input": _brief(c.get("input") or {})}
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

    yield {"type": "done", "text": "", "tools": used}
