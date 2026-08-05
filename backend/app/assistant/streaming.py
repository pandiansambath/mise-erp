"""Watching the assistant work, instead of watching a spinner.

The owner's complaint, verbatim: *"when I give a prompt I was waiting for so
long without confirmation whether the AI is working or not."* A tool-use turn
can take fifteen seconds — it reads sales, then stock, then thinks — and every
second of that looked identical to a hang.

An elapsed counter and a collapsible trace already shipped, but both arrived at
the END, which fixes the explaining and not the waiting. This streams instead:

    thought  → what it said to itself before reaching for a tool
    tool     → which one, and what it asked for
    delta    → the answer, a few words at a time, as it is written
    done     → the finished text, so the client never has to reassemble it

Two things this design has to respect:

**A tool-use loop cannot stream its final answer early.** You do not know
whether a lap will end in an answer or a tool call until the blocks arrive. So
every lap is streamed, and text deltas are only forwarded on the lap that turns
out to be the last one — otherwise the model's private "let me check the sales"
would be typed out as if it were the reply.

**boto3 is synchronous.** The stream is drained on a worker thread and handed
over through a queue, so one person's slow answer never blocks the event loop
for everybody else.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from app.assistant import bedrock

log = logging.getLogger("mise.assistant.streaming")

# A sentinel that cannot collide with a real event.
_END = object()


async def _events(body: dict[str, Any], model: str = "") -> AsyncIterator[dict]:
    """Raw Anthropic streaming events off Bedrock, without blocking the loop."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    loop = asyncio.get_running_loop()

    def pump() -> None:
        try:
            resp = bedrock._client().invoke_model_with_response_stream(
                modelId=model or bedrock._model_id(),
                body=json.dumps(body),
            )
            for event in resp["body"]:
                chunk = event.get("chunk")
                if not chunk:
                    continue
                asyncio.run_coroutine_threadsafe(
                    queue.put(json.loads(chunk["bytes"])), loop
                ).result()
        except Exception as exc:  # noqa: BLE001 — reported to the caller as an event
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "_error", "message": str(exc)}), loop
            ).result()
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(_END), loop).result()

    task = loop.run_in_executor(None, pump)
    try:
        while True:
            item = await queue.get()
            if item is _END:
                return
            yield item
    finally:
        await task


async def _one_lap(
    body: dict[str, Any],
    model: str,
    *,
    on_delta,
) -> tuple[str, list[dict], dict]:
    """Stream one exchange. Returns (text, tool_use blocks, usage).

    `on_delta` is called with each fragment of text as it arrives, and may be
    None on a lap whose text is the model's private reasoning rather than the
    reply.
    """
    text_parts: list[str] = []
    tools: list[dict] = []
    # tool_use arguments stream as fragments of JSON and are only valid once
    # the block closes.
    current: dict | None = None
    partial: list[str] = []
    usage: dict = {}

    async for ev in _events(body, model):
        kind = ev.get("type")

        if kind == "_error":
            raise bedrock.BedrockUnavailable(ev.get("message", "stream failed"))

        if kind == "content_block_start":
            block = ev.get("content_block") or {}
            if block.get("type") == "tool_use":
                current = {"type": "tool_use", "id": block.get("id"), "name": block.get("name")}
                partial = []

        elif kind == "content_block_delta":
            delta = ev.get("delta") or {}
            if delta.get("type") == "text_delta":
                piece = delta.get("text", "")
                text_parts.append(piece)
                if on_delta is not None and piece:
                    await on_delta(piece)
            elif delta.get("type") == "input_json_delta":
                partial.append(delta.get("partial_json", ""))

        elif kind == "content_block_stop":
            if current is not None:
                raw = "".join(partial)
                try:
                    current["input"] = json.loads(raw) if raw.strip() else {}
                except json.JSONDecodeError:
                    # A truncated argument is not worth guessing at — an empty
                    # input makes the tool fail loudly instead of silently
                    # running with half a filter.
                    log.warning("tool arguments did not parse: %s", raw[:200])
                    current["input"] = {}
                tools.append(current)
                current = None
                partial = []

        elif kind in ("message_delta", "message_start"):
            u = (ev.get("usage") or {}) or ((ev.get("message") or {}).get("usage") or {})
            for key in ("input_tokens", "output_tokens"):
                if u.get(key):
                    usage[key] = usage.get(key, 0) + int(u[key])
            for src, dst in (
                ("cache_read_input_tokens", "cache_read_tokens"),
                ("cache_creation_input_tokens", "cache_write_tokens"),
            ):
                if u.get(src):
                    usage[dst] = usage.get(dst, 0) + int(u[src])

    return "".join(text_parts), tools, usage
