"""Tests for the in-process SSE event bus."""
import uuid

import pytest

from app.core import events


@pytest.mark.asyncio
async def test_event_bus_fans_out_to_subscribers():
    hotel = uuid.uuid4()
    q1 = events.subscribe(hotel)
    q2 = events.subscribe(hotel)
    assert events.subscriber_count(hotel) == 2

    await events.publish(hotel, {"type": "purchasing", "action": "po_received"})
    assert q1.get_nowait()["action"] == "po_received"
    assert q2.get_nowait()["action"] == "po_received"

    # events are scoped per hotel
    other = uuid.uuid4()
    qo = events.subscribe(other)
    await events.publish(hotel, {"type": "purchasing"})
    assert qo.empty()

    events.unsubscribe(hotel, q1)
    events.unsubscribe(hotel, q2)
    events.unsubscribe(other, qo)
    assert events.subscriber_count(hotel) == 0
    # publishing with no subscribers is a harmless no-op
    await events.publish(hotel, {"type": "purchasing"})
