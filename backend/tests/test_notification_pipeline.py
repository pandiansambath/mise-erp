"""The bell's one promise, held with the cheapest possible test.

    "price alerts has 10+ notifications which is hiding some important ones."

`app/notifications/pipeline.py` shapes the feed in five stages — BUILD, LIFT,
COLLAPSE, SORT, CAP — and makes exactly one guarantee:

    No `severity: danger` item can ever be collapsed, capped or trimmed.

These are pure-function assertions: no database, no HTTP. Every way of
squeezing the feed is turned up as far as it goes — fifty noisy rows, a cap of
zero, the danger row's area muted, the danger row itself dismissed — and the
out-of-stock is still on screen, in its box's pinned list, every time.
"""
import pytest

from app.notifications import pipeline as p


def _row(id_: str, area: str, severity: str = "info", **extra) -> dict:
    return {"id": id_, "area": area, "severity": severity, "title": id_, **extra}


def _noisy_feed(price_rises: int = 50, sales: int = 30, outs: int = 3) -> list[dict]:
    rows = [_row(f"price:{i}:1.{i}", "prices", "warn") for i in range(price_rises)]
    rows += [_row(f"act:{i}", "sales") for i in range(sales)]
    # The danger rows arrive LAST — the position a flat list would bury them in.
    rows += [_row(f"out:{i}", "stock", "danger") for i in range(outs)]
    return rows


def _where(shaped: dict) -> dict[str, str]:
    """{row id: 'pinned' | 'items' | 'more'} for every row actually sent."""
    found: dict[str, str] = {}
    for g in shaped["groups"]:
        for place in ("pinned", "items", "more"):
            for r in g[place]:
                found[r["id"]] = place
    return found


# ── THE INVARIANT ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("show,limit", [(3, 12), (1, 1), (0, 0)])
def test_danger_is_never_collapsed_capped_or_trimmed(show, limit):
    shaped = p.run(_noisy_feed(), {}, show=show, limit=limit)
    where = _where(shaped)

    for i in range(3):
        assert where.get(f"out:{i}") == "pinned", (f"out:{i}", show, limit)
    assert shaped["urgent"] == 3
    # And nothing that is NOT danger sneaks into the pinned list.
    assert all(
        r["severity"] == "danger" for g in shaped["groups"] for r in g["pinned"]
    )


def test_danger_survives_its_own_dismissal_and_a_muted_area():
    """A dismissal and a mute are both a person's choice — and neither may hide
    an empty bin. The low-stock row in the same area DOES go: the mute works,
    it just cannot reach danger."""
    feed = _noisy_feed() + [_row("low:9", "stock", "warn")]
    marks = {
        "out:0": p.Mark(dismissed=True),
        p.mute_key("stock"): p.Mark(dismissed=True),
    }
    shaped = p.run(feed, marks, show=0, limit=0)
    where = _where(shaped)

    assert [where.get(f"out:{i}") for i in range(3)] == ["pinned"] * 3
    assert "low:9" not in where
    assert not any(r["id"].startswith("out:") for r in shaped["dismissed"])
    assert shaped["muted"] == [
        {"area": "stock", "label": "Stock", "icon": "📦", "count": 1}
    ]


def test_cap_does_not_count_pinned_rows_against_the_box():
    """Ten out-of-stocks and a cap of two: all ten shown, AND the two ordinary
    rows — danger is not allowed to eat the room the warnings were given."""
    feed = [_row(f"out:{i}", "stock", "danger") for i in range(10)]
    feed += [_row(f"low:{i}", "stock", "warn") for i in range(5)]
    (stock,) = p.run(feed, {}, show=1, limit=2)["groups"]

    assert len(stock["pinned"]) == 10
    assert len(stock["items"]) + len(stock["more"]) == 2
    assert stock["hidden"] == 3
    assert stock["total"] == 15


# ── GROUPING ──────────────────────────────────────────────────────────────


def test_a_noisy_area_grows_its_own_more_not_the_page():
    shaped = p.run(_noisy_feed(), {}, show=3, limit=12)
    prices = next(g for g in shaped["groups"] if g["area"] == "prices")

    assert len(prices["items"]) == 3
    assert len(prices["more"]) == 9
    assert prices["hidden"] == 50 - 12
    # The count is the truth, not the number that happened to be sent.
    assert prices["total"] == 50 and prices["unread"] == 50


def test_boxes_order_danger_then_for_you_then_severity_then_fixed_order():
    feed = [
        _row("act:1", "sales"),
        _row("price:1:2", "prices", "warn"),
        _row("docreq:1", "mine"),
        _row("act:2", "rota"),
        _row("out:1", "stock", "danger"),
    ]
    order = [g["area"] for g in p.run(feed, {})["groups"]]
    assert order == ["stock", "mine", "prices", "sales", "rota"]


def test_box_order_does_not_follow_volume():
    """Ranking by how many rows a box has is exactly how a noisy area wins."""
    quiet_first = [_row("act:r", "rota")] + [_row(f"act:s{i}", "sales") for i in range(40)]
    order = [g["area"] for g in p.run(quiet_first, {})["groups"]]
    assert order == ["sales", "rota"]  # the fixed order, both info

    noisy_first = [_row(f"act:s{i}", "sales") for i in range(40)] + [_row("act:r", "rota")]
    assert [g["area"] for g in p.run(noisy_first, {})["groups"]] == order


def test_inside_a_box_warnings_lead_and_equal_rows_keep_their_order():
    feed = [
        _row("docreq:old", "mine", "info"),
        _row("shift:1", "mine", "info"),
        _row("docreq:late", "mine", "warn"),
        _row("shift:2", "mine", "info"),
    ]
    (mine,) = p.run(feed, {}, show=10)["groups"]
    assert [r["id"] for r in mine["items"]] == ["docreq:late", "docreq:old", "shift:1", "shift:2"]


def test_the_same_feed_shapes_the_same_way_twice():
    """Rows must not shuffle under the cursor between two polls."""
    a = p.run(_noisy_feed(), {})
    b = p.run(_noisy_feed(), {})
    assert _where(a) == _where(b)
    assert [g["area"] for g in a["groups"]] == [g["area"] for g in b["groups"]]


def test_unknown_area_lands_in_everything_else():
    (g,) = p.run([_row("act:x", "not-a-real-area")], {})["groups"]
    assert g["area"] == "other"


# ── STATE ─────────────────────────────────────────────────────────────────


def test_read_and_dismissed_are_applied():
    feed = [_row("price:1:2", "prices", "warn"), _row("price:2:3", "prices", "warn")]
    marks = {"price:1:2": p.Mark(read=True), "price:2:3": p.Mark(dismissed=True)}
    shaped = p.run(feed, marks)

    (prices,) = shaped["groups"]
    assert [(r["id"], r["read"]) for r in prices["items"]] == [("price:1:2", True)]
    assert prices["unread"] == 0
    assert [r["id"] for r in shaped["dismissed"]] == ["price:2:3"]
    assert shaped["dismissed_count"] == 1


def test_a_row_built_as_read_stays_read():
    """Your own actions arrive read — the router sets it, the marks cannot undo it."""
    (g,) = p.run([_row("act:1", "sales", read=True)], {})["groups"]
    assert g["items"][0]["read"] is True and g["unread"] == 0


# ── KEYED ON THE PREFIX ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "action,area",
    [
        ("shift.move", "rota"),        # the one an exact-key table missed
        ("shift.something_new", "rota"),
        ("sale.add", "sales"),
        ("stock.waste", "stock"),
        ("inventory.category.move", "stock"),
        ("po.received", "purchasing"),
        ("ai.commit_bill", "purchasing"),
        ("ai.read_any", "other"),
        ("table.update", "tables"),
        ("payroll.approve_all", "payroll"),
        ("platform.flags", "other"),
    ],
)
def test_actions_are_routed_by_prefix(action, area):
    assert p.area_for_action(action) == area


def test_every_area_is_unique_and_has_a_door():
    keys = [a.key for a in p.AREAS]
    assert len(keys) == len(set(keys))
    assert all(a.route.startswith("/") for a in p.AREAS)
    assert "other" in keys and "mine" in keys
