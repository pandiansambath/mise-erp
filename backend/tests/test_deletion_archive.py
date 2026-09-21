"""The backup must cover exactly what the delete removes.

    "if they need there datas back we need a feature in control center to
     revert back they datas to old"

`preview()` and `purge()` derive their tables from the live foreign-key graph.
`archive()` walked `ORDERED_TABLES`, a hand-typed list — so the deletion was
defined by the schema and the backup by a list somebody last edited months
ago. `audit_events` was purged while the list named `audit_logs`; `chats`,
`dining_tables`, `baskets` and `ai_usage` were purged and never saved.

A backup that is a SUBSET of the delete is the worst shape this can take,
because it looks like it worked and only fails when somebody needs it.

No database here, on purpose — the same reason `test_deletion_plan` gives:
this is the code that only ever runs while irreversibly destroying data, so
it has to be testable without any.
"""
import json
import uuid

import pytest

from app.platform_admin import deletion

HOTEL = uuid.uuid4()

#: A plan with the shapes that actually caused trouble: a table reached
#: through its parent (no hotel_id of its own), and a table whose name is NOT
#: in ORDERED_TABLES at all.
PLAN = [
    ("po_items", "purchase_order_id IN (SELECT id FROM purchase_orders WHERE hotel_id = :h)"),
    ("purchase_orders", "hotel_id = :h"),
    ("audit_events", "hotel_id = :h"),
    ("ai_usage", "hotel_id = :h"),
    ("chats", "hotel_id = :h"),
]


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class FakeDB:
    """Records every statement, returns one row per table so the dump is not
    trivially empty."""

    def __init__(self):
        self.sql: list[str] = []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.sql.append(sql)

        class Row:
            _mapping = {"id": "row-1"}

        return _Result([Row()])


@pytest.fixture
def captured(monkeypatch):
    """Run `archive` against the fake plan and hand back what it would upload."""
    box: dict = {}

    async def fake_plan(_db):
        return PLAN

    class FakeS3:
        def put_object(self, **kw):
            box["key"] = kw["Key"]
            box["body"] = json.loads(kw["Body"].decode())

    class FakeBoto:
        @staticmethod
        def client(*_a, **_kw):
            return FakeS3()

    monkeypatch.setattr(deletion, "_delete_plan", fake_plan)
    monkeypatch.setattr(deletion.settings, "s3_bucket", "test-bucket", raising=False)
    monkeypatch.setitem(__import__("sys").modules, "boto3", FakeBoto)
    return box


@pytest.mark.asyncio
async def test_archive_saves_every_table_the_purge_deletes(captured):
    db = FakeDB()
    key = await deletion.archive(db, HOTEL, "spice-garden")

    assert key, "archiving must succeed, or the caller refuses to delete"
    saved = set(captured["body"]["tables"])
    expected = {tbl for tbl, _w in PLAN} | {"hotels"}

    assert saved == expected, f"not saved: {expected - saved}"


@pytest.mark.asyncio
async def test_archive_uses_the_plans_own_where_clause(captured):
    """A table reached THROUGH ITS PARENT has no hotel_id. The old code
    assumed `WHERE hotel_id = :h` for everything, so those tables came back
    empty — or errored — even when they were on the list."""
    db = FakeDB()
    await deletion.archive(db, HOTEL, "spice-garden")

    child = next(s for s in db.sql if "po_items" in s)
    assert "purchase_order_id IN" in child, f"used the wrong predicate: {child}"


@pytest.mark.asyncio
async def test_archive_does_not_consult_the_hand_typed_list(captured, monkeypatch):
    """THE REGRESSION, pinned at the root. Emptying ORDERED_TABLES must not
    change what gets saved — if it does, something is reading it again."""
    monkeypatch.setattr(deletion, "ORDERED_TABLES", ())
    db = FakeDB()
    await deletion.archive(db, HOTEL, "spice-garden")

    saved = set(captured["body"]["tables"])
    assert saved == {tbl for tbl, _w in PLAN} | {"hotels"}


@pytest.mark.asyncio
async def test_the_restore_order_is_recorded(captured):
    """Saved children-first; a restore walks it BACKWARDS so parents exist
    before the rows pointing at them. Leaving a restore to infer the order
    from JSON key order is not something to stake a recovery on."""
    db = FakeDB()
    await deletion.archive(db, HOTEL, "spice-garden")
    order = captured["body"]["order"]

    assert order[-1] == "hotels", "the hotel row is written last, restored first"
    assert order.index("po_items") < order.index("purchase_orders"), "children first"
    assert set(order) == set(captured["body"]["tables"])


@pytest.mark.asyncio
async def test_counts_travel_with_the_backup(captured):
    """So a restore — or a person — can tell a genuinely empty table from one
    that silently failed to read."""
    db = FakeDB()
    await deletion.archive(db, HOTEL, "spice-garden")
    body = captured["body"]

    assert body["row_counts"]["chats"] == 1
    assert body["hotel_id"] == str(HOTEL)
    assert body["version"] == 2


@pytest.mark.asyncio
async def test_no_bucket_means_no_archive_and_therefore_no_delete(monkeypatch):
    """An irreversible action does not proceed on a best-effort backup."""
    monkeypatch.setattr(deletion.settings, "s3_bucket", "", raising=False)
    assert await deletion.archive(FakeDB(), HOTEL, "spice-garden") is None


@pytest.mark.asyncio
async def test_an_upload_failure_returns_none_rather_than_raising(monkeypatch):
    """The caller checks for None. An exception here would escape as a 500
    AFTER the operator typed the hotel name, which reads like it worked."""

    async def fake_plan(_db):
        return PLAN

    class Boom:
        @staticmethod
        def client(*_a, **_kw):
            raise RuntimeError("no credentials")

    monkeypatch.setattr(deletion, "_delete_plan", fake_plan)
    monkeypatch.setattr(deletion.settings, "s3_bucket", "test-bucket", raising=False)
    monkeypatch.setitem(__import__("sys").modules, "boto3", Boom)

    assert await deletion.archive(FakeDB(), HOTEL, "spice-garden") is None
