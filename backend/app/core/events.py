"""Tiny in-process pub/sub for Server-Sent Events (live UI updates).

Each hotel has a set of subscriber queues; publishing an event fans it out to
all of that hotel's open SSE connections. In-memory = perfect for a single
app instance (our low-cost deploy). For multi-instance, swap this for Redis
pub/sub later — the publish()/subscribe() surface stays the same.
"""
import asyncio
import uuid
from collections import defaultdict

_subscribers: dict[uuid.UUID, set[asyncio.Queue]] = defaultdict(set)


def subscribe(hotel_id: uuid.UUID) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers[hotel_id].add(q)
    return q


def unsubscribe(hotel_id: uuid.UUID, q: asyncio.Queue) -> None:
    subs = _subscribers.get(hotel_id)
    if subs is not None:
        subs.discard(q)
        if not subs:
            _subscribers.pop(hotel_id, None)


async def publish(hotel_id: uuid.UUID, event: dict) -> None:
    """Fan an event out to every open connection for this hotel (non-blocking)."""
    for q in list(_subscribers.get(hotel_id, ())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:  # slow/stuck client — skip it
            pass


def subscriber_count(hotel_id: uuid.UUID) -> int:
    return len(_subscribers.get(hotel_id, ()))
